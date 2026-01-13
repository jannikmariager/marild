import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type ContactRequestRow = {
  id: string;
  email: string;
  message: string;
  source: string;
  created_at: string;
};

async function getData() {
  const { data } = await supabaseAdmin
    .from("contact_requests")
    .select("id, email, message, source, created_at")
    .order("created_at", { ascending: false });

  return (data as ContactRequestRow[] | null) ?? [];
}

export default async function ContactRequestsPage() {
  const requests = await getData();

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Contact requests</h1>
        <p className="text-sm text-muted-foreground">
          Direct messages from the public landing page. Treat these like high-intent conversations.
        </p>
      </header>

      <div className="overflow-x-auto rounded-lg border border-border bg-card/80">
        <table className="min-w-full text-sm">
          <thead className="bg-muted text-muted-foreground text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Email</th>
              <th className="px-3 py-2 text-left font-medium">Message</th>
              <th className="px-3 py-2 text-left font-medium">Source</th>
              <th className="px-3 py-2 text-left font-medium">Created at</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((row) => (
              <tr key={row.id} className="border-t border-border/70 align-top">
                <td className="px-3 py-3 font-medium">{row.email}</td>
                <td className="px-3 py-3 whitespace-pre-wrap text-sm text-foreground/90">
                  {row.message && row.message !== "No message provided" ? row.message : (
                    <span className="text-muted-foreground">No additional message</span>
                  )}
                </td>
                <td className="px-3 py-3 text-muted-foreground">{row.source}</td>
                <td className="px-3 py-3 text-muted-foreground">{new Date(row.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-muted-foreground" colSpan={4}>
                  No contact requests yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
