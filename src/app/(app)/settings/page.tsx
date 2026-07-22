import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { auth, googleOnlyIntent } from "@/lib/auth";
import {
  BinanceBrokerCard,
  BitgetBrokerCard,
  ChangePasswordCard,
  MetaApiBrokerCard,
  MexcBrokerCard,
  TelegramNotifyCard,
} from "./brokers-client";

export default async function SettingsPage() {
  const session = await auth();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Cài đặt"
        description="Kết nối sàn, thông báo và thông tin tài khoản."
      />

      <Tabs defaultValue="brokers">
        <TabsList>
          <TabsTrigger value="brokers">Sàn giao dịch</TabsTrigger>
          <TabsTrigger value="account">Tài khoản</TabsTrigger>
          <TabsTrigger value="preferences">Tùy chọn</TabsTrigger>
        </TabsList>

        <TabsContent value="brokers" className="mt-4 space-y-4">
          <BitgetBrokerCard />
          <BinanceBrokerCard />
          <MexcBrokerCard />
          <TelegramNotifyCard />
          <MetaApiBrokerCard />
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
          {/* No password to change when Google is the only login method. */}
          {googleOnlyIntent ? null : <ChangePasswordCard />}
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
