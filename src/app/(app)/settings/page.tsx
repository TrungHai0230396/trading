import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { auth, googleOnlyIntent } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  BinanceBrokerCard,
  BitgetBrokerCard,
  BrokerConnectionSummary,
  ChangePasswordCard,
  ForexBrokerCard,
  MexcBrokerCard,
  OkxBrokerCard,
  TelegramNotifyCard,
} from "./brokers-client";
import { AccountCard } from "./account-client";
import { ScrollToHash } from "@/components/scroll-to-hash";

export default async function SettingsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  const user = userId
    ? await db.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true, createdAt: true },
      })
    : null;

  return (
    <div className="mx-auto max-w-5xl">
      {/* /scanner links here as /settings#telegram when the user has no
          Telegram connection. This page awaits the session and a user row, so
          the card does not exist when the browser looks for the hash. */}
      <ScrollToHash />
      <PageHeader
        title="Cài đặt"
        description="Kết nối sàn, thông báo và thông tin tài khoản."
      />

      <Tabs defaultValue="brokers">
        <TabsList>
          <TabsTrigger value="brokers">Sàn giao dịch</TabsTrigger>
          <TabsTrigger value="account">Tài khoản</TabsTrigger>
        </TabsList>

        <TabsContent value="brokers" className="mt-4 space-y-6">
          <BrokerConnectionSummary />
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <BitgetBrokerCard />
            <BinanceBrokerCard />
            <MexcBrokerCard />
            <OkxBrokerCard />
            {/* Forex sits with the exchanges so "which brokers does this app
                work with" has ONE answer in one place — even though it has no
                API connection and works through the MT4/MT5 import. */}
            <ForexBrokerCard />
          </div>
          <TelegramNotifyCard />
          {/* MetaApi (Exness / MT4 · MT5) tạm ẩn — chưa setup được. Component
              vẫn còn trong brokers-client.tsx để bật lại khi sẵn sàng. */}
        </TabsContent>

        <TabsContent value="account" className="mt-4 space-y-4">
          {user && userId ? (
            <AccountCard
              email={user.email}
              name={user.name}
              userId={userId}
              joinedAt={user.createdAt.toISOString()}
            />
          ) : null}
          {/* No password to change when Google is the only login method. */}
          {googleOnlyIntent ? null : <ChangePasswordCard />}

          <p className="text-xs text-muted-foreground">
            Tùy chọn (tiền tệ mặc định, đơn vị lot, chủ đề giao diện) sẽ có ở
            giai đoạn tiếp theo.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
