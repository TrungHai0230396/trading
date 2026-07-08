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
import {
  BinanceBrokerCard,
  BitgetBrokerCard,
  ChangePasswordCard,
  ConsensusAlertCard,
  MetaApiBrokerCard,
  RiskLimitsCard,
  TelegramNotifyCard,
} from "./brokers-client";

const API_KEY_DEFINITIONS = [
  {
    kind: "GEMINI",
    label: "Google Gemini",
    description: "Dùng cho tóm tắt tin tức, báo cáo on-chain, narrative scanner.",
    docs: "https://aistudio.google.com/app/apikey",
  },
  {
    kind: "TWELVE_DATA",
    label: "Twelve Data",
    description:
      "Free 800 req/ngày. Cung cấp giá forex & crypto cho calculator và scanner.",
    docs: "https://twelvedata.com/",
  },
  {
    kind: "CRYPTOPANIC",
    label: "CryptoPanic",
    description:
      "Aggregator tin tức crypto (có gói free) — nuôi card Tin nóng + tin liên quan trên trang phân tích.",
    docs: "https://cryptopanic.com/developers/api/",
  },
];

export default async function SettingsPage() {
  const session = await auth();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Cài đặt"
        description="API keys, thông tin tài khoản và tùy chọn mặc định."
      />

      <Tabs defaultValue="brokers">
        <TabsList>
          <TabsTrigger value="brokers">Sàn giao dịch</TabsTrigger>
          <TabsTrigger value="keys">API keys</TabsTrigger>
          <TabsTrigger value="account">Tài khoản</TabsTrigger>
          <TabsTrigger value="preferences">Tùy chọn</TabsTrigger>
        </TabsList>

        <TabsContent value="brokers" className="mt-4 space-y-4">
          <BitgetBrokerCard />
          <BinanceBrokerCard />
          <RiskLimitsCard />
          <TelegramNotifyCard />
          <ConsensusAlertCard />
          <MetaApiBrokerCard />
        </TabsContent>

        <TabsContent value="keys" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">API keys</CardTitle>
              <CardDescription>
                Lưu ở DB dưới dạng AES-encrypted. Giao diện CRUD sẽ có ở phase
                1.5 — tạm thời bạn có thể seed qua{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  prisma studio
                </code>{" "}
                hoặc đặt trong file{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  .env
                </code>
                .
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
                    Lấy key →
                  </a>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="account" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tài khoản</CardTitle>
              <CardDescription>
                Bạn đang đăng nhập với tài khoản cá nhân.
              </CardDescription>
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
          <ChangePasswordCard />
        </TabsContent>

        <TabsContent value="preferences" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tùy chọn</CardTitle>
              <CardDescription>
                Tiền tệ tài khoản mặc định, đơn vị lot, chủ đề giao diện — sẽ
                có ở giai đoạn tiếp theo.
              </CardDescription>
            </CardHeader>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
