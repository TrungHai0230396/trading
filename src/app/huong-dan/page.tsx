/**
 * Hướng dẫn sử dụng — public (no auth).
 *
 * Public on purpose: it is the page the launch post links to, so a stranger
 * can understand what the app does — and, more importantly, satisfy themselves
 * about the read-only API-key story — BEFORE deciding to sign in. Server-
 * rendered plain markup like /terms so it stays readable if the app shell or
 * JS fails.
 */

import Link from "next/link";
import {
  BookOpenText,
  Calculator,
  ChartColumn,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Radar,
  Send,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export const metadata = {
  title: "Hướng dẫn sử dụng — Nhật Ký Trade",
  description:
    "Cách dùng Nhật Ký Trade: ghi nhật ký, tính khối lượng lệnh, quét đa khung, nối sàn chỉ-đọc và đọc báo cáo kỷ luật.",
};

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="scroll-mt-20">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Icon className="size-5 shrink-0 text-primary" />
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
        {n}
      </span>
      <span className="flex-1">{children}</span>
    </li>
  );
}

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">
        Hướng dẫn sử dụng
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Nhật Ký Trade là cuốn sổ ghi lệnh cho trader, kèm vài công cụ tính toán
        và quan sát thị trường. Trang này đi qua từng phần, theo đúng thứ tự
        bạn sẽ dùng.
      </p>

      {/* The single most important thing a stranger needs to believe. */}
      <div className="mt-8 rounded-lg border border-bullish/40 bg-bullish/5 p-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <ShieldCheck className="size-5 shrink-0 text-bullish" />
          Đọc trước: app này chỉ đọc, không đặt lệnh
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Nhật Ký Trade <strong className="text-foreground">không bao giờ</strong>{" "}
          vào lệnh, đóng lệnh hay rút tiền thay bạn. Trong mã nguồn không có
          đường nào làm việc đó. API key bạn nối vào chỉ cần quyền{" "}
          <strong className="text-foreground">đọc</strong> — không cần quyền
          giao dịch, không cần quyền rút tiền. Bạn tự vào lệnh trên sàn, rồi
          quay về đây ghi lại.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          App cũng không phím hàng và không đưa lời khuyên đầu tư. Mọi con số ở
          đây là mô tả lại dữ liệu của chính bạn.
        </p>
      </div>

      <nav className="mt-8 rounded-lg border bg-card/40 p-4 text-sm">
        <p className="font-medium">Nội dung</p>
        <ol className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
          <li>1. Bắt đầu trong 5 phút</li>
          <li>2. Ghi nhật ký giao dịch</li>
          <li>3. Hệ thống &amp; checklist</li>
          <li>4. Tính khối lượng lệnh</li>
          <li>5. Quét đa khung</li>
          <li>6. Nối sàn (chỉ đọc)</li>
          <li>7. Thông báo Telegram</li>
          <li>8. Đọc báo cáo</li>
        </ol>
      </nav>

      <div className="mt-10 space-y-10">
        <Section icon={LayoutDashboard} title="1. Bắt đầu trong 5 phút">
          <ol className="space-y-2">
            <Step n={1}>
              Đăng nhập bằng Google. Không cần tạo mật khẩu riêng.
            </Step>
            <Step n={2}>
              Vào <strong className="text-foreground">Nhật ký giao dịch</strong>{" "}
              → <strong className="text-foreground">Lệnh mới</strong>, ghi thử
              một lệnh bạn vừa vào. Chỉ cần symbol, giá vào, khối lượng và giờ
              vào là lưu được.
            </Step>
            <Step n={3}>
              Khi đóng lệnh trên sàn, mở lại lệnh đó, chuyển trạng thái sang{" "}
              <em>Đã đóng</em> và <strong className="text-foreground">nhập
              lãi/lỗ thật</strong> từ sàn.
            </Step>
            <Step n={4}>
              Sau khoảng 20–30 lệnh, các trang báo cáo mới bắt đầu có ý nghĩa
              thống kê. Trước đó con số còn quá ít để kết luận điều gì.
            </Step>
          </ol>
        </Section>

        <Section icon={BookOpenText} title="2. Ghi nhật ký giao dịch">
          <p>
            Đây là phần lõi. Mỗi lệnh có ba nhóm thông tin:
          </p>
          <ul className="ml-4 list-disc space-y-1.5">
            <li>
              <strong className="text-foreground">Số liệu</strong> — symbol,
              hướng, giá vào, stop loss, take profit, khối lượng, số tiền risk.
            </li>
            <li>
              <strong className="text-foreground">Bối cảnh</strong> — ảnh chụp
              chart, setup, ghi chú. Ảnh dán thẳng bằng Ctrl/Cmd + V, và thêm
              được ngay lúc tạo lệnh mới.
            </li>
            <li>
              <strong className="text-foreground">Bản thân bạn</strong> — cảm
              xúc lúc vào lệnh và sai lầm đã mắc. Hai ô này trông thừa nhưng
              chính là nguyên liệu cho báo cáo ở mục 8. Bỏ trống thì báo cáo đó
              cũng trống theo.
            </li>
          </ul>
          <p>
            <strong className="text-foreground">Ba trạng thái:</strong>{" "}
            <em>Chờ khớp</em> (đã đặt lệnh, chưa vào), <em>Đang mở</em>,{" "}
            <em>Đã đóng</em>.
          </p>
          <p className="rounded-md border border-dashed p-3">
            App <strong className="text-foreground">không tự tính lãi/lỗ hộ
            bạn</strong>. Số liệu tính toán luôn lệch với sàn vì phí, funding,
            trượt giá — mà một con số sai tự tin còn tệ hơn không có số. Bạn
            nhập số thật từ sàn, thống kê mới đáng tin.
          </p>
          <p>
            Đã có sẵn lịch sử ở MT4/MT5? Dùng{" "}
            <strong className="text-foreground">Nhập từ MT4/MT5</strong> để tải
            lên file báo cáo HTML xuất từ tab <em>Account History</em>.
          </p>
        </Section>

        <Section icon={ListChecks} title="3. Hệ thống & checklist">
          <p>
            Một &ldquo;hệ thống&rdquo; là chiến lược của bạn, kèm danh sách điều
            kiện phải thoả trước khi vào lệnh. Ví dụ: <em>giá phá vùng tích
            luỹ</em>, <em>volume tăng</em>, <em>R:R tối thiểu 1:2</em>. Đánh dấu
            mục nào <em>bắt buộc</em>.
          </p>
          <p>
            Mỗi lần ghi lệnh, bạn tick những điều kiện đã thoả. App lưu lại{" "}
            <strong className="text-foreground">bản chụp checklist tại thời
            điểm đó</strong> — nên sau này bạn sửa hệ thống cũng không làm sai
            lệch lịch sử.
          </p>
          <p>
            Đổi lại, trang{" "}
            <strong className="text-foreground">Phân tích hệ thống</strong> so
            được cho bạn: tỷ lệ thắng khi <em>theo đúng</em> checklist so với
            khi <em>phá luật</em>. Đây thường là con số khó chịu nhất, và cũng
            hữu ích nhất.
          </p>
          <p>
            Tạo hoặc sửa hệ thống ngay trong form ghi lệnh, không cần rời trang.
          </p>
        </Section>

        <Section icon={Calculator} title="4. Tính khối lượng lệnh">
          <p>
            Nhập <strong className="text-foreground">số tiền bạn chấp nhận
            mất</strong> và <strong className="text-foreground">stop
            loss</strong>, app trả về khối lượng cần vào — lot cho forex, units
            cho crypto. Hỗ trợ cả vàng và bạc với đúng quy ước hợp đồng
            (1 lot vàng = 100 oz, không phải 100.000).
          </p>
          <ul className="ml-4 list-disc space-y-1.5">
            <li>
              Stop loss nhập theo <em>pips</em> hoặc theo <em>giá</em>.
            </li>
            <li>
              Take profit là tuỳ chọn — điền vào thì được mang sang nhật ký luôn.
            </li>
            <li>
              Với crypto futures có gợi ý đòn bẩy. App luôn{" "}
              <strong className="text-foreground">làm tròn xuống</strong>: đòn
              bẩy thấp hơn = ký quỹ nhiều hơn = giá thanh lý nằm xa stop loss
              hơn.
            </li>
            <li>
              Bấm <strong className="text-foreground">Tạo lệnh trong Nhật
              ký</strong> để mở form với mọi ô đã điền sẵn.
            </li>
          </ul>
          <p>
            Nếu khối lượng tính ra nhỏ hơn 0.01 lot, app sẽ báo rõ và gợi ý hai
            cách xử lý (tăng risk hoặc thu hẹp stop) thay vì tự làm tròn lên —
            làm tròn lên là âm thầm tăng rủi ro của bạn.
          </p>
          <p>App tự nhớ thông số bạn nhập, F5 không mất.</p>
        </Section>

        <Section icon={Radar} title="5. Quét đa khung">
          <p>
            Chọn vài coin, chọn các khung thời gian, app chấm điểm tín hiệu trên
            từng khung rồi tổng hợp lại xem các khung đang{" "}
            <strong className="text-foreground">đồng thuận</strong> hay đang cãi
            nhau.
          </p>
          <p>
            Bấm vào một coin để mở trang phân tích sâu: các mức giá đáng chú ý,
            gợi ý điểm vào/SL/TP, và nút{" "}
            <strong className="text-foreground">Ghi vào Nhật ký</strong> để
            chuyển thẳng kế hoạch đó sang form ghi lệnh.
          </p>
          <p className="rounded-md border border-dashed p-3">
            Đây là <strong className="text-foreground">công cụ quan sát</strong>,
            không phải tín hiệu mua bán. &ldquo;Đồng thuận&rdquo; chỉ có nghĩa
            là các khung đang cùng chiều — thị trường vẫn có thể đi ngược bất cứ
            lúc nào.
          </p>
        </Section>

        <Section icon={KeyRound} title="6. Nối sàn (chỉ đọc)">
          <p>
            Nối được Bitget, Binance, MEXC, OKX để xem tổng tài sản và vị thế
            đang mở ở một chỗ.
          </p>
          <ol className="space-y-2">
            <Step n={1}>
              Vào trang quản lý API của sàn, tạo key mới.
            </Step>
            <Step n={2}>
              Quyền: <strong className="text-foreground">chỉ tick
              Read/Đọc</strong>. Không tick Trade, không tick Withdraw. App
              không cần và không dùng được những quyền đó.
            </Step>
            <Step n={3}>
              Dán key vào <strong className="text-foreground">Cài đặt →</strong>{" "}
              thẻ sàn tương ứng. Key được mã hoá trước khi lưu.
            </Step>
          </ol>
          <p>
            Xong rồi, bấm{" "}
            <strong className="text-foreground">Đồng bộ sàn</strong> ở Nhật ký
            để nhập vị thế đang mở vào sổ. Khi bạn đóng vị thế trên sàn, app tự
            nhận ra và đóng lệnh tương ứng — với Bitget và Binance thì lấy được
            cả giá thoát và phí thật; với MEXC và OKX thì app đánh dấu để bạn tự
            nhập, chứ không đoán số.
          </p>
        </Section>

        <Section icon={Send} title="7. Thông báo Telegram">
          <p>
            Vào <strong className="text-foreground">Cài đặt → Thông báo
            Telegram</strong>, bấm kết nối, rồi bấm <em>Start</em> trong
            Telegram. Xong.
          </p>
          <ul className="ml-4 list-disc space-y-1.5">
            <li>
              <strong className="text-foreground">Tín hiệu đồng thuận</strong> —
              coin trong watchlist có tín hiệu thì bot nhắn. Chọn coin và khung
              ở trang Quét đa khung.
            </li>
            <li>
              <strong className="text-foreground">Chạm SL/TP của bạn</strong> —
              giá chạm mức bạn đã ghi trong nhật ký thì bot nhắc vào cập nhật
              kết quả.
            </li>
            <li>
              <strong className="text-foreground">Tổng kết tuần</strong> — vài
              dòng số liệu của chính bạn, đầu tuần.
            </li>
          </ul>
          <p>
            Hai mục sau mặc định <strong className="text-foreground">tắt</strong>
            , bạn tự bật nếu muốn. Muốn dừng hẳn thì gõ{" "}
            <code className="rounded bg-muted px-1">/stop</code> trong Telegram.
          </p>
        </Section>

        <Section icon={ChartColumn} title="8. Đọc báo cáo">
          <p>Có ba trang nhìn lại, mỗi trang trả lời một câu hỏi khác nhau:</p>
          <ul className="ml-4 list-disc space-y-1.5">
            <li>
              <strong className="text-foreground">Tổng quan</strong> — tôi đang
              đứng ở đâu? Tài sản, lệnh đang mở, đường equity.
            </li>
            <li>
              <strong className="text-foreground">Phân tích hệ thống</strong> —
              chiến lược nào ăn tiền, và kỷ luật có giúp gì không?
            </li>
            <li>
              <strong className="text-foreground">Điều gì đang lấy tiền của
              bạn</strong> — gộp lệnh theo tag, cảm xúc và sai lầm; đếm số lệnh
              không đặt SL; xem bạn hay đóng tay giữa chừng hay để chạm SL/TP;
              và số tiền risk có phình lên sau khi thua không.
            </li>
          </ul>
          <p className="rounded-md border border-dashed p-3">
            Mọi báo cáo đều hiện <strong className="text-foreground">mẫu
            số</strong> (kiểu &ldquo;tính trên 23/60 lệnh&rdquo;) để bạn biết
            con số dựa trên bao nhiêu lệnh. Ba lệnh thì chưa phải quy luật.
            Báo cáo chỉ nêu điều đã xảy ra, không bảo bạn nên làm gì.
          </p>
        </Section>
      </div>

      <div className="mt-12 rounded-lg border bg-card/40 p-4 text-sm">
        <p className="font-medium">Còn vướng chỗ nào?</p>
        <p className="mt-1 text-muted-foreground">
          Trong app có trang <strong className="text-foreground">Liên hệ &amp;
          Góp ý</strong> — báo lỗi hay đề xuất tính năng đều gửi được từ đó.
        </p>
      </div>

      <div className="mt-8 flex flex-wrap gap-4 text-sm">
        <Link href="/" className="font-medium text-primary hover:underline">
          Vào app →
        </Link>
        <Link
          href="/terms"
          className="font-medium text-muted-foreground hover:underline"
        >
          Điều khoản &amp; miễn trừ trách nhiệm
        </Link>
      </div>
    </div>
  );
}
