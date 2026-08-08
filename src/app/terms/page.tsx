/**
 * Điều khoản sử dụng & Miễn trừ trách nhiệm.
 *
 * Public (no auth) — linked from the registration consent checkbox.
 * Deliberately plain server-rendered text: this page must be readable
 * even when the app shell/JS fails.
 */

import Link from "next/link";
import { PublicPageExit } from "@/components/public-page-exit";

export const metadata = {
  title: "Điều khoản sử dụng — Nhật Ký Trade",
};

const UPDATED = "07/07/2026";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">
        Điều khoản sử dụng & Miễn trừ trách nhiệm
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Cập nhật lần cuối: {UPDATED}
      </p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed">
        <section className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-4">
          <h2 className="font-semibold">⚠️ Cảnh báo rủi ro — đọc trước tiên</h2>
          <p className="mt-2">
            Giao dịch tài sản số và các sản phẩm phái sinh (futures) có mức
            rủi ro RẤT CAO, đặc biệt khi sử dụng đòn bẩy. Bạn có thể mất
            toàn bộ số vốn. Chỉ giao dịch bằng số tiền bạn sẵn sàng mất.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">1. Nhật Ký Trade là gì</h2>
          <p className="mt-2">
            Nhật Ký Trade là <strong>công cụ phần mềm</strong> hỗ trợ cá nhân tự
            quản lý hoạt động giao dịch của chính mình: nhật ký giao dịch,
            máy tính khối lượng lệnh, quét chỉ báo kỹ thuật đa khung thời
            gian và thông báo tự động. Nhật Ký Trade <strong>không phải</strong>{" "}
            sàn giao dịch, không phải công ty môi giới, không phải đơn vị tư
            vấn đầu tư và không quản lý tiền của bạn.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">
            2. Không phải lời khuyên đầu tư
          </h2>
          <p className="mt-2">
            Mọi số liệu, chỉ báo, điểm đồng thuận, phân tích AI, tin tức và
            thông báo trong ứng dụng chỉ mang tính{" "}
            <strong>tham khảo kỹ thuật</strong>, được tạo tự động từ dữ liệu
            thị trường công khai. Chúng <strong>không phải</strong> khuyến
            nghị mua/bán, không phải tư vấn tài chính, và không đảm bảo bất
            kỳ kết quả nào. Mọi quyết định giao dịch — và toàn bộ lời/lỗ phát
            sinh — thuộc trách nhiệm của riêng bạn.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">3. Tài khoản chỉ-đọc</h2>
          <p className="mt-2">
            Nhật Ký Trade hoạt động hoàn toàn ở chế độ <strong>chỉ-đọc</strong>: khi
            bạn kết nối API sàn giao dịch, ứng dụng chỉ ĐỌC số dư, vị thế và
            lịch sử lệnh để đồng bộ nhật ký. Ứng dụng <strong>không có</strong>{" "}
            chức năng đặt, sửa hay huỷ lệnh. Hãy tạo API key{" "}
            <strong>chỉ có quyền Read</strong> và không bao giờ cấp quyền
            Trade/Withdraw/Transfer.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">4. Dữ liệu & bảo mật</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              API key sàn giao dịch được mã hoá AES-256-GCM trước khi lưu;
              không hiển thị lại nguyên văn sau khi lưu.
            </li>
            <li>Mật khẩu được băm bcrypt; chúng tôi không biết mật khẩu của bạn.</li>
            <li>
              Dữ liệu nhật ký/giao dịch của bạn chỉ thuộc về tài khoản của
              bạn và không chia sẻ cho người dùng khác.
            </li>
            <li>
              Bạn tự chịu trách nhiệm giữ an toàn mật khẩu, API key và tài
              khoản Telegram nhận thông báo.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-base font-semibold">5. Giới hạn trách nhiệm</h2>
          <p className="mt-2">
            Ứng dụng được cung cấp “nguyên trạng” (as-is). Trong phạm vi tối
            đa pháp luật cho phép, Nhật Ký Trade không chịu trách nhiệm cho bất
            kỳ tổn thất nào phát sinh từ: quyết định giao dịch của bạn; dữ
            liệu thị trường sai/chậm từ bên thứ ba (Binance, Bitget, MEXC, OKX, nhà
            cung cấp dữ liệu); gián đoạn dịch vụ, lỗi phần mềm; hoặc thông
            báo đến chậm/thất lạc (Telegram, mạng). Tín hiệu kỹ thuật có thể
            sai — và thường xuyên sai trong thị trường biến động.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">6. Tuân thủ pháp luật</h2>
          <p className="mt-2">
            Bạn tự chịu trách nhiệm bảo đảm việc giao dịch của mình tuân thủ
            pháp luật nơi bạn cư trú, bao gồm quy định về tài sản số tại
            Việt Nam. Không sử dụng ứng dụng cho hoạt động phi pháp.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold">7. Thay đổi điều khoản</h2>
          <p className="mt-2">
            Điều khoản có thể được cập nhật; phiên bản mới có hiệu lực khi
            đăng tại trang này. Tiếp tục sử dụng sau thay đổi đồng nghĩa với
            việc chấp nhận điều khoản mới.
          </p>
        </section>
      </div>

      <div className="mt-10 flex flex-wrap gap-4">
        <PublicPageExit />
        <Link
          href="/huong-dan"
          className="text-sm font-medium text-muted-foreground hover:underline"
        >
          Hướng dẫn sử dụng
        </Link>
      </div>
    </div>
  );
}
