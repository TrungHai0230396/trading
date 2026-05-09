import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { auth } from "@/lib/auth";

const API_KEY_DEFINITIONS = [
  {
    kind: "GEMINI",
    label: "Google Gemini",
    description: "Used for news summarization, on-chain reports, scanner narrative.",
    docs: "https://aistudio.google.com/app/apikey",
  },
  {
    kind: "TWELVE_DATA",
    label: "Twelve Data",
    description: "Free 800 req/day. Forex & crypto prices for the calculator and scanner.",
    docs: "https://twelvedata.com/",
  },
  {
    kind: "CRYPTOPANIC",
    label: "CryptoPanic",
    description: "Crypto news aggregator. Free tier available.",
    docs: "https://cryptopanic.com/developers/api/",
  },
  {
    kind: "ETHERSCAN",
    label: "Etherscan",
    description: "Ethereum on-chain queries: balances, txs, ERC-20 transfers.",
    docs: "https://etherscan.io/myapikey",
  },
  {
    kind: "BSCSCAN",
    label: "BscScan",
    description: "BNB Smart Chain on-chain queries.",
    docs: "https://bscscan.com/myapikey",
  },
];

export default async function SettingsPage() {
  const session = await auth();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Settings"
        description="API keys, account preferences, and defaults."
      />

      <Tabs defaultValue="keys">
        <TabsList>
          <TabsTrigger value="keys">API keys</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
        </TabsList>

        <TabsContent value="keys" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">API keys</CardTitle>
              <CardDescription>
                Stored AES-encrypted at rest. CRUD UI lands in Phase 1.5 — for
                now, you can seed via{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  prisma studio
                </code>{" "}
                or env-based seeding.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {API_KEY_DEFINITIONS.map((k) => (
                <div
                  key={k.kind}
                  className="flex flex-col gap-2 rounded-md border bg-card/40 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{k.label}</span>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {k.kind}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {k.description}
                    </p>
                  </div>
                  <a
                    href={k.docs}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Get key →
                  </a>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="account" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Account</CardTitle>
              <CardDescription>Signed in as your single-user account.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Email</span>
                <span className="font-medium">{session?.user?.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">User ID</span>
                <span className="font-mono text-xs">{session?.user?.id}</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preferences" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preferences</CardTitle>
              <CardDescription>
                Default account currency, default lot size unit, theme — coming
                in Phase 2.
              </CardDescription>
            </CardHeader>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
