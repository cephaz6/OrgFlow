// A conditional-property update: setting to undefined omits the key rather
// than storing an explicit undefined value. exactOptionalPropertyTypes
// (tsconfig.base.json) distinguishes "key absent" from "key present with
// value undefined", and only the former satisfies an optional property's
// type; `{ ...obj, key: value }` produces the latter whenever value is
// undefined, so form fields clearing an optional input (an emptied hint,
// description, category) need this instead of a plain spread.
export function withOptional<T extends object, K extends keyof T>(
  obj: T,
  key: K,
  value: T[K] | undefined,
): T {
  if (value === undefined) {
    const { [key]: _removed, ...rest } = obj;
    return rest as T;
  }
  return { ...obj, [key]: value };
}
