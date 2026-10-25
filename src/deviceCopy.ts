/** UI wording only. Authorization and device identity never depend on OS labels. */
export function deviceCopy(platform: string | null | undefined) {
  if (platform === "win32") return {
    label: "This Windows PC",
    location: "this Windows PC",
  };
  if (platform === "darwin") return {
    label: "This Mac",
    location: "this Mac",
  };
  return {
    label: "This device",
    location: "this device",
  };
}
