import { useSyncExternalStore } from "react";
import { formatUploadDate, latestUploadDate, subscribeUploadDates } from "./lib/uploadDates";
export default function LastUpdatedFooter({ files }: { files: string[] }) {
  const date = useSyncExternalStore(subscribeUploadDates, () => latestUploadDate(files), () => null);
  return <footer style={{ width: "100%", boxSizing: "border-box", padding: "12px 4px 6px",
    borderTop: "1px solid rgba(0,0,0,0.10)", marginTop: 16, color: "#667085",
    fontSize: 12, lineHeight: 1.5, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
    title="Latest upload of the data used by this view · Australia/Brisbane">
    Last Updated: {date === null ? "Unavailable" : <time dateTime={new Date(date).toISOString()}><em>{formatUploadDate(date)}</em></time>}
  </footer>;
}
