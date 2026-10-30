# SAT Practice — web ôn thi Digital SAT

Web luyện đề SAT với giao diện mô phỏng ứng dụng **Bluebook**. Bạn tải file đề lên, web tự **xào đề** thành bài thi thử theo đúng cấu trúc Digital SAT, trong đó **Module 2 luôn là module khó**. Có **trợ lý AI** (Claude) hỗ trợ ngay trên web.

## Tính năng

**Giao diện thi giống Bluebook**
- Header gồm tên Section/Module, Directions, đồng hồ đếm ngược (có nút Hide), Highlights & Notes, More; riêng Math có thêm Calculator (Desmos bản dùng cho Digital SAT) và Reference sheet.
- Reading & Writing chia 2 khung (đoạn văn bên trái, câu hỏi bên phải), kéo được thanh chia ở giữa.
- Mark for Review, công cụ loại trừ đáp án (ABC gạch ngang / Undo), bảng điều hướng "Question X of N", trang Check Your Work.
- Câu Math tự điền (SPR) có hướng dẫn bên trái và Answer Preview.
- Bôi đen chữ để highlight (3 màu) và ghi chú.
- Nghỉ 10 phút giữa hai phần, hết giờ thì tự chuyển module. Không quay lại được module đã làm.
- Tiến độ được lưu tự động: tải lại trang vẫn làm tiếp được.
- Phím tắt: A–D để chọn, Shift+A–D để gạch, ←/→ để chuyển câu, M để đánh dấu.

**Xào đề**
- Mỗi phần có 2 module: RW 27 câu/32 phút, Math 22 câu/35 phút (hoặc chọn bài ngắn hơn).
- Module 1 trộn khoảng 1/3 dễ, 1/3 trung bình, 1/3 khó.
- **Module 2 luôn khó**: khoảng 70% câu khó, 30% câu trung bình, không có câu dễ. Câu khó được giữ lại cho Module 2 trước.
- Hai module không trùng câu. Web ưu tiên những câu bạn ít gặp, có thể đảo thứ tự đáp án A–D, và sắp câu theo kiểu đề thật (RW theo nhóm domain, Math từ dễ đến khó).

**Tải đề lên**: PDF, DOCX, TXT/MD, JSON.
- Nếu file viết theo mẫu (xem `public/sample/sample-format.txt`) hoặc là JSON thì web đọc được mà không cần AI.
- Nếu bật AI: Claude đọc PDF bất kỳ (cả bản scan, có công thức hay bảng), tự nhận diện phần, độ khó và domain, rồi lấy đáp án từ answer key trong file. Nếu file không có đáp án thì AI tự giải và câu đó được gắn nhãn "AI".
- Trong ngân hàng đề bạn có thể xem, sửa và xoá câu, lọc theo nguồn, hoặc xuất ra JSON.

**Câu có hình / đồ thị**
- Vào Ngân hàng đề, bấm **Xem / sửa** ở câu cần hình. Chụp hình trong PDF (`Win + Shift + S`) rồi bấm **Ctrl + V** để dán, hoặc kéo thả hay chọn file ảnh. Khi thi, ảnh hiện ở đúng chỗ như trên Bluebook.
- Trong file TXT: ghi dòng `Image: cau12.png` rồi chọn file ảnh **cùng lúc** với file .txt khi tải lên. Dòng `Figure: <mô tả>` ghi lại là câu này cần hình.
- Câu có mô tả hình mà chưa gắn ảnh sẽ có nhãn **⚠ Thiếu hình**. Dùng bộ lọc "Thiếu hình" để tìm các câu còn phải dán ảnh.
- Ảnh được lưu trong `data/images/`.

**AI kiểm tra đáp án** (cho file có đáp án sai)
- Bấm **🔍 AI kiểm tra đáp án** trong Ngân hàng đề, hoặc tick "Sau khi tải, cho AI giải lại…" lúc tải file lên.
- AI giải lại từng câu ở mức suy nghĩ cao nhất và **không được xem đáp án trong file**, để không bị đáp án sai dẫn dắt.
- Câu nào AI ra khác với file thì bị đánh dấu **⚠ Nghi sai**. Mở câu đó ra sẽ thấy đáp án file, đáp án AI, độ tin cậy và lời giải của AI. Bạn chọn **Dùng đáp án AI** hoặc **Giữ đáp án file**; web không tự ghi đè.
- Lọc nhanh các câu nghi sai bằng bộ lọc "⚠ Nghi sai đáp án". Câu đã kiểm tra sẽ không bị kiểm tra lại (đỡ tốn phí).
- AI không đúng 100%, nhất là với câu có hình hoặc đồ thị. Câu nào AI để độ tin cậy "thấp" thì nên tự xem lại.

**Kết quả và AI**
- Điểm ước tính trên thang 200–800 cho mỗi phần, xem đúng/sai theo module và theo domain, thời gian làm từng câu, lọc câu sai, câu bỏ trống hoặc câu đã đánh dấu.
- Gia sư AI:
  - Khi xem lại bài: giải thích chi tiết từng câu và chỉ ra "vì sao mình sai".
  - Nút "Tạo 3 câu tương tự": AI soạn thêm câu cùng dạng và đưa vào ngân hàng.
  - Ở chế độ luyện tập, bạn được hỏi AI trong lúc làm bài, nhưng AI chỉ gợi ý chứ không nói thẳng đáp án.
  - Ở chế độ thi thật, AI bị khoá (server chặn luôn) cho đến khi nộp bài.

## Cài đặt & chạy

**Cách nhanh nhất (bấm đúp):**
1. Cài [Node.js](https://nodejs.org) bản LTS (chỉ làm 1 lần).
2. Bấm đúp file **`Chay-web-Windows.bat`** (Windows) hoặc **`Chay-web-Mac.command`** (Mac). Lần đầu file sẽ tự cài thư viện, sau đó tự mở trình duyệt vào web.
   - Trên Mac, nếu máy báo "không mở được vì từ nhà phát triển không xác định", hãy chuột phải vào file → **Open** → **Open**. Chỉ phải làm vậy lần đầu.
3. Đóng cửa sổ đen là web tắt.

**Bật AI (không bắt buộc):** đổi tên file `.env.example` thành `.env`, rồi điền key vào dòng `ANTHROPIC_API_KEY=`. Web tự đọc key này mỗi lần chạy.

**Chạy bằng lệnh (cách cũ):**
```bash
npm install
npm start                   # mở http://localhost:3000
```

Mới chạy lần đầu, vào **Ngân hàng đề → Nạp bộ câu mẫu** (55 câu) để thử ngay. Nếu không có API key, web vẫn chạy đầy đủ, chỉ tắt các tính năng AI.

Dữ liệu (ngân hàng câu hỏi, bài thi, kết quả) được lưu trong `data/`.

## Định dạng JSON

```json
{ "questions": [
  { "section": "rw", "difficulty": "hard", "domain": "Craft and Structure",
    "passage": "…", "prompt": "Which choice …?", "choices": ["…","…","…","…"],
    "answer": "B", "explanation": "…" },
  { "section": "math", "difficulty": "medium", "type": "spr",
    "prompt": "If $x/4 + x/6 = 5$, what is $x$?", "answer": "12" }
]}
```
- `section`: `rw` | `math`
- `difficulty`: `easy` | `medium` | `hard`
- `answer`: chữ cái A–D. Với câu SPR, ghi các đáp án chấp nhận được, ngăn bằng `|`, ví dụ `"2/3|.6666|.6667"`.
- Công thức viết bằng LaTeX trong `$…$`, gạch chân bằng `__từ__`, bảng dùng cú pháp markdown. Muốn có hình thì thêm `image` (URL) hoặc `figure` (mô tả hình bằng chữ).

## Cấu trúc mã

| File | Vai trò |
|---|---|
| `server.js` | API Express: ngân hàng đề, upload, tạo đề, chấm điểm, AI |
| `src/testBuilder.js` | Thuật toán xào đề (Module 2 khó) và chấm điểm |
| `src/questions.js` | Chuẩn hoá câu hỏi, đọc JSON và file văn bản theo mẫu |
| `src/ai.js` | Gọi Claude: đọc đề từ PDF/văn bản, gia sư, sinh câu tương tự |
| `public/exam.html`, `public/js/exam.js` | Giao diện thi kiểu Bluebook |
| `public/index.html`, `public/js/home.js` | Trang tạo đề, ngân hàng đề, lịch sử |
| `public/result.html`, `public/js/result.js` | Kết quả và xem lại bài |

Chạy test: `npm test`.

> Điểm số chỉ là ước tính để luyện tập, không phải thang điểm chính thức của College Board.
