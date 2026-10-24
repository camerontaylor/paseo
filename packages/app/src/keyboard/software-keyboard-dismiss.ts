import { Keyboard } from "react-native";

/** Dismiss the focused software keyboard without changing the composer draft. */
export function dismissSoftwareKeyboard() {
  Keyboard.dismiss();
}
