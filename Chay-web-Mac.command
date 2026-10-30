#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Chưa cài Node.js. Đang mở trang tải — hãy cài bản LTS rồi bấm lại file này."
  open "https://nodejs.org"
  read -r -p "Nhấn Enter để đóng..."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Lần đầu chạy: đang cài thư viện, đợi khoảng 1 phút..."
  npm install || { echo "Cài thư viện bị lỗi. Kiểm tra mạng rồi thử lại."; read -r -p "Nhấn Enter để đóng..."; exit 1; }
fi
OPEN_BROWSER=1 node server.js
