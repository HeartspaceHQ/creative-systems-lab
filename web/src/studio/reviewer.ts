import { useState } from "react";

const KEY = "csl.reviewer";

function stored(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

/** The reviewer's name, remembered on this computer so it is filled in next time. */
export function useReviewer(): { name: string; setName: (value: string) => void; remember: () => void } {
  const [name, setName] = useState(stored);
  const remember = (): void => {
    try {
      window.localStorage.setItem(KEY, name.trim());
    } catch {
      // Remembering the name is a convenience only.
    }
  };
  return { name, setName, remember };
}
