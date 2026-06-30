/**
 * Light background for the whole /admin/media section (list pages, editors,
 * and the loading skeleton). Without this, the app's dark poster-collage
 * backdrop shows through behind the pages' dark text, making headings and the
 * toolbar hard to read — the dashboard solves the same problem with bg-gray-50.
 */
export default function MediaSectionLayout({ children }) {
  return <div className="min-h-screen bg-gray-50">{children}</div>
}
