import { ApiError } from '../middleware/errors.js';

// Only these static help entries can become provider input.
const help = [
  [/quen mat khau|khoi phuc mat khau|dat lai mat khau/, 'Làm gì khi quên mật khẩu?', 'Ở trang Đăng nhập, chọn Quên mật khẩu, nhập email hoặc số điện thoại đã đăng ký và mở liên kết khôi phục gửi về email.'],
  [/otp|xac thuc|xac minh|khong nhan.*(?:mail|ma)|gui lai.*(?:mail|ma)/, 'Làm gì khi chưa nhận được email xác thực hoặc OTP?', 'Trong Hoàn tất hồ sơ, email xác thực dùng liên kết gửi tới email đăng ký. Kiểm tra địa chỉ, thư rác và thời gian gửi lại hiển thị. SMS dùng mã khi có cấu hình. Trợ lý không tra được trạng thái gửi thực tế.'],
  [/ngan sach|han muc chi/, 'Cách tạo ngân sách?', 'Mở Ngân sách, chọn tháng và năm, bấm Tạo ngân sách, chọn danh mục chi, nhập hạn mức, ngưỡng cảnh báo rồi lưu. Tự động gia hạn là tùy chọn và chỉ chuyển phần dư dương.'],
  [/chuyen (?:tien|vi)|thanh toan the|tra no the|dieu chinh so du|vi cua toi|tao vi|them vi|du no/, 'Quản lý ví và số dư như thế nào?', 'Ví của tôi quản lý tiền mặt, ngân hàng, ví điện tử và thẻ tín dụng. Có Điều chỉnh số dư, Chuyển ví và Thanh toán thẻ. Mua bằng thẻ được tính chi tại thời điểm mua.'],
  [/muc tieu|hu chi tieu|tien vao hu/, 'Cách quản lý hũ chi tiêu?', 'Trong Mục tiêu, chọn Tạo hũ chi tiêu, nhập tên và số tiền mục tiêu. Chọn thêm tiền vào hũ để cộng vào số tiền đã dành và cập nhật tiến độ.'],
  [/bao cao|ty trong|so sanh chi/, 'Cách xem báo cáo chi tiêu?', 'Chọn kỳ theo tháng và năm tại Báo cáo, xem cơ cấu chi theo danh mục và so sánh với những kỳ trước.'],
  [/cai dat|chu ky|doi mat khau|dinh dang so|doi ten danh muc|an danh muc|them danh muc|ho so/, 'Có thể chỉnh những gì trong Cài đặt?', 'Cài đặt hỗ trợ quản lý danh mục Thu và Chi, định dạng số, ngày bắt đầu chu kỳ, sửa hồ sơ và đổi mật khẩu.'],
  [/giao dich|ghi khoan (?:thu|chi)/, 'Cách thêm và xem giao dịch?', 'Mở Giao dịch và chọn Thêm giao dịch. Chọn Thu hoặc Chi, nhập số tiền VND, danh mục, ví, ngày và ghi chú nếu cần rồi lưu. Danh sách có bộ lọc theo ngày, loại, ví và danh mục.'],
  [/tong quan|tong thu chi/, 'Tổng quan hiển thị những gì?', 'Tổng quan tóm tắt thu chi, biến động theo thời gian, giao dịch gần đây và tiến độ của các hũ.'],
];

const instructions = 'Bạn là Trợ lý AI của LÁ, ứng dụng quản lý thu chi cá nhân. Trả lời ngắn gọn bằng tiếng Việt, dùng văn bản thuần và hướng dẫn thao tác từng bước, dựa vào nội dung trợ giúp được cung cấp. Nếu chưa đủ thông tin, hãy hỏi người dùng đang ở trang nào hoặc thấy trạng thái nào. Không yêu cầu thông tin tài khoản, mật khẩu, OTP hoặc số liệu tài chính. Không nói rằng bạn đã truy cập dữ liệu hoặc thực hiện thao tác thay người dùng.';

function findHelp(message) {
  const normalized = message.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replaceAll('đ','d').replace(/\s+/g,' ');
  let earliest = Infinity;
  let entry;
  for (const topic of help) {
    const index = normalized.search(topic[0]);
    if (index >= 0 && index < earliest) {
      earliest = index;
      entry = topic;
    }
  }
  return entry;
}

export async function askSupport(config,message,fetchAi=fetch) {
  if (!config?.apiKey) {
    throw new ApiError(503,'SUPPORT_NOT_CONFIGURED','Trợ lý AI chưa được cấu hình. Bạn có thể xem hướng dẫn ở trang Trợ giúp.');
  }
  const entry = findHelp(message);
  if (!entry) return 'Bạn đang cần trợ giúp ở trang nào của LÁ? Hãy cho mình biết tên chức năng hoặc thao tác bạn muốn thực hiện.';
  const [,question,guide] = entry;
  try {
    const response = await fetchAi('https://api.openai.com/v1/responses',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(12_000),
      headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:config.model,instructions,input:`${question}\n${guide}`,max_output_tokens:360,store:false}),
    });
    if (!response.ok) throw new Error('provider_error');
    const result = await response.json();
    const answer = result.output?.filter(item=>item.type === 'message')
      .flatMap(item=>item.content || [])
      .filter(item=>item.type === 'output_text' && typeof item.text === 'string')
      .map(item=>item.text).join('\n').trim();
    if (result.status !== 'completed' || !answer) throw new Error('provider_incomplete');
    return answer.slice(0,2400);
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new ApiError(504,'SUPPORT_TIMEOUT','Trợ lý AI phản hồi quá lâu. Bạn có thể thử lại.');
    }
    throw new ApiError(502,'SUPPORT_UNAVAILABLE','Trợ lý AI đang tạm thời gián đoạn. Bạn có thể thử lại.');
  }
}
