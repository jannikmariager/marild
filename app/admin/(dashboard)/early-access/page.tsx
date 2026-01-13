import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type EarlyAccessRow = { id: string; email: string; created_at: string };
type FoundingCircleRow = {
  id: string;
  email: string;
  status: string;
  created_at: string;
  answers: {
    whyInterested?: string;
    describeToTrader?: string;
    tradingActivity?: string;
    introductionChannels?: string[];
  } | null;
};

async function getData() {
  const [{ data: signups }, { data: applications }] = await Promise.all([
    supabaseAdmin
      .from("early_access_signups")
      .select("id, email, created_at")
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("founding_circle_applications")
      .select("id, email, status, created_at, answers")
      .order("created_at", { ascending: false }),
  ]);

  return {
    signups: (signups as EarlyAccessRow[] | null) ?? [],
    applications: (applications as FoundingCircleRow[] | null) ?? [],
  };
}

export default async function EarlyAccessAdminPage() {
  const { signups, applications } = await getData();

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Early access &amp; Founding Circle</h1>
        <p className="text-sm text-muted-foreground">
          Internal view of early access signups and Founding Circle applications. Data is read-only here;
          status updates should be done via SQL or a dedicated workflow.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Early access signups</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-card/80">
          <table className="min-w-full text-xs">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Email</th>
                <th className="px-3 py-2 text-left font-medium">Created at</th>
              </tr>
            </thead>
            <tbody>
              {signups.map((row) => (
                <tr key={row.id} className="border-t border-border/60">
                  <td className="px-3 py-2 align-top">{row.email}</td>
                  <td className="px-3 py-2 align-top text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
              {signups.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-muted-foreground" colSpan={2}>
                    No early access signups yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Founding Circle applications</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-card/80">
          <table className="min-w-full text-xs">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Email</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Created at</th>
                <th className="px-3 py-2 text-left font-medium">Application details</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((row) => (
                <tr key={row.id} className="border-t border-border/60 align-top">
                  <td className="px-3 py-2 align-top whitespace-nowrap">{row.email}</td>
                  <td className="px-3 py-2 align-top whitespace-nowrap">{row.status}</td>
                  <td className="px-3 py-2 align-top text-muted-foreground whitespace-nowrap">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 align-top max-w-xl">
                    {row.answers ? (
                      <div className="space-y-1 text-xs">
                        {row.answers.whyInterested && (
                          <p>
                            <span className="font-medium">Why interested:</span> {row.answers.whyInterested}
                          </p>
                        )}
                        {row.answers.describeToTrader && (
                          <p>
                            <span className="font-medium">How they would describe Marild:</span> {row.answers.describeToTrader}
                          </p>
                        )}
                        {row.answers.tradingActivity && (
                          <p>
                            <span className="font-medium">Trading activity:</span> {row.answers.tradingActivity}
                          </p>
                        )}
                        {Array.isArray(row.answers.introductionChannels) &&
                          row.answers.introductionChannels.length > 0 && (
                            <p>
                              <span className="font-medium">Introduction channels:</span> {" "}
                              {row.answers.introductionChannels.join(", ")}
                            </p>
                          )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">No answers recorded</span>
                    )}
                  </td>
                </tr>
              ))}
              {applications.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-muted-foreground" colSpan={4}>
                    No applications submitted yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}