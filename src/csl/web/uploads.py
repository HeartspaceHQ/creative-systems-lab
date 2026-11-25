"""Images that arrive from the browser: decoded, checked and re-encoded as clean PNG.

Nothing the sender wrote survives: the bytes are decoded by Pillow, the pixels are written to a
new PNG, and the metadata (EXIF, GPS, text chunks, ICC profile) is left behind, after the
orientation and the colour profile have been applied to the pixels. A file that is not an
image, or is too large to decode safely, is refused with a sentence for the designer.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass
from http import HTTPStatus
from urllib.parse import unquote

from PIL import Image, ImageCms, ImageOps, UnidentifiedImageError

from csl.web.problems import ApiError

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_PIXELS = 40_000_000
UPLOAD_TYPES = {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}
_NAME_LIMIT = 80
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]")
_SRGB = ImageCms.createProfile("sRGB")


@dataclass(frozen=True)
class CleanImage:
    """A decoded upload: PNG bytes without metadata, and the size in pixels."""

    png: bytes
    width: int
    height: int


def display_name(raw: str | None) -> str:
    """A file name safe to show: no folders, no control characters, at most 80 characters."""
    name = _CONTROL.sub("", unquote(raw or "")).replace("\\", "/").rsplit("/", 1)[-1].strip()
    return name[:_NAME_LIMIT] or "image"


def _to_srgb(image: Image.Image) -> Image.Image:
    """Apply an embedded colour profile to the pixels, so dropping it changes no colour."""
    profile = image.info.get("icc_profile")
    if not isinstance(profile, bytes) or image.mode not in {"RGB", "RGBA"}:
        return image
    try:
        source = ImageCms.ImageCmsProfile(io.BytesIO(profile))
        converted = ImageCms.profileToProfile(image, source, _SRGB, outputMode=image.mode)
    except (ImageCms.PyCMSError, OSError):
        return image  # a broken profile: keep the pixels as they are
    return converted or image


def clean_image(data: bytes, content_type: str) -> CleanImage:
    """Decode an uploaded image and return it as metadata-free PNG, or raise ``ApiError``."""
    expected = UPLOAD_TYPES.get(content_type.split(";", maxsplit=1)[0].strip().lower())
    if expected is None:
        msg = "Upload a PNG, JPEG or WebP image."
        raise ApiError(msg, HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
    try:
        with Image.open(io.BytesIO(data)) as source:
            if source.format != expected:
                msg = "The file is not the kind of image it says it is. Upload a PNG, JPEG or WebP."
                raise ApiError(msg)
            if source.width * source.height > MAX_PIXELS:
                msg = "That image is larger than 40 megapixels. Resize it and try again."
                raise ApiError(msg, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
            source.load()
            upright = ImageOps.exif_transpose(source)
            mode = "RGBA" if "A" in upright.getbands() or "transparency" in upright.info else "RGB"
            pixels = _to_srgb(upright.convert(mode))
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError) as error:
        msg = "That file could not be read as an image. Try saving it again as PNG or JPEG."
        raise ApiError(msg) from error
    pixels.info.clear()
    buffer = io.BytesIO()
    pixels.save(buffer, format="PNG")
    return CleanImage(buffer.getvalue(), pixels.width, pixels.height)
