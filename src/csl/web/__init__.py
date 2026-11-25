"""A small local web API and its static frontend (``web/``), built on the existing modules.

The API adds no review logic of its own: decisions go through ``csl.review.decide`` and
verification through ``csl.reproduce.verify``, exactly as the command line does.
"""
