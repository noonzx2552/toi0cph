# TOI Zero Helper for CPH

เครื่องมือสำหรับคนทำโจทย์แข่งขันใน VS Code ที่เอา `Competitive Programming Helper (CPH)` มาต่อยอดให้เข้ากับ workflow ของ `TOI Zero` แบบครบชุด

![Screenshot](screenshots/screenshot-main.png)

## ภาพรวม

โปรเจกต์นี้คือ fork ของ CPH ที่ยังคงจุดเด่นเดิมไว้ครบ:

- รัน testcases ในเครื่องได้ทันที
- import โจทย์จาก Competitive Companion
- compile, judge, และ submit ได้จากใน VS Code
- รองรับหลายภาษา

และเพิ่ม workflow สำหรับ `TOI Zero` เข้าไปโดยตรง:

- ดูสถานะงานและคะแนนจาก sidebar
- ดาวน์โหลด statement PDF ของแต่ละ task
- ดึง source ที่ผ่านแล้วมาเก็บไว้เป็นชุด
- submit งานที่เปิดอยู่ หรือ submit ทีเดียวทุก task ที่ผ่านแล้ว
- เช็กผล submission ล่าสุดได้จากใน editor

## จุดเด่น

- UI แบบ dashboard สำหรับ `TOI Zero` ที่ดู status ได้เร็ว
- tree view แยกงาน `A1`, `A2`, `A3`
- มีสถานะ task ชัดเจน เช่น `DONE`, `LOW`, `TODO`, `EXCLUDED`
- cache source ที่ผ่านแล้วไว้ใน `.toi-zero/passed-sources/`
- export source ไปที่ `toi-passed-code/`
- เปิด solution จาก `PakinDioxide/TOI-zero` ได้ตรง ๆ
- รองรับการ submit จากไฟล์ที่กำลังเปิดอยู่
- รองรับ C/C++/Python ตาม mapping ที่ใช้กับ TOI

## เริ่มใช้งานเร็ว ๆ

1. ติดตั้ง extension นี้ใน VS Code แล้วเปิดโฟลเดอร์งาน
2. เปิดแท็บ `TOI Zero` จาก Activity Bar
3. กด `TOI Zero: Refresh Status` เพื่อ login และโหลดรายการ task
4. เลือก task ที่ต้องการ แล้วใช้คำสั่งที่เหมาะกับงาน

ถ้าต้องการทดสอบโค้ดในเครื่อง:

- กด <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> เพื่อรัน testcases
- กด <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd> เพื่อ submit ไป Codeforces
- กด <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd> เพื่อโฟกัสหน้าต่าง TOI Zero testcases

## TOI Zero Workflow

คำสั่งหลักที่ใช้งานบ่อย:

- `TOI Zero: Refresh Status` - login และดึงสถานะล่าสุดของ TOI Zero
- `TOI Zero: Show Status JSON` - เปิด JSON สถานะที่ parse แล้ว
- `TOI Zero: Show Solved Scores` - ดูรายการงานที่ solve แล้วพร้อมคะแนน
- `TOI Zero: Download PDF` - ดาวน์โหลด statement PDF ของ task ที่เลือก
- `TOI Zero: Download Passed Code` - export source ของ task ที่ผ่านแล้ว
- `TOI Zero: Submit Active File` - submit ไฟล์ที่เปิดอยู่ไปยัง task ที่เลือก
- `TOI Zero: Submit All Passed` - submit source ที่ผ่านแล้วทั้งหมดในชุดเดียว
- `TOI Zero: Check Submission Result` - เช็กผล submission ล่าสุดของ task
- `TOI Zero: Open Solution (PakinDioxide)` - เปิด solution reference
- `TOI Zero: Clear Saved Login` - ลบ username/password ที่บันทึกไว้

สถานะของ task ที่แสดงใน tree:

- `DONE` - คะแนนถึงเกณฑ์และนับรวมแล้ว
- `LOW` - เคย submit แล้วแต่คะแนนยังต่ำกว่าเกณฑ์
- `TODO` - ยังไม่มีคะแนนผ่าน
- `EXCLUDED` - ถูกยกเว้นจาก criteria
- `EXCLUDED_OK` - ถูกยกเว้น แต่มีคะแนนผ่านแล้ว

## โครงสร้างไฟล์ที่เกี่ยวข้อง

- `.toi-zero/passed-sources/` - cache source ที่ผ่านแล้ว
- `toi-passed-code/` - ไฟล์ที่ export ออกมาเพื่อใช้งานต่อ
- `toi-pdfs/` - statement PDF ที่ดาวน์โหลดมา

## ภาษาที่รองรับ

- C++
- C
- C#
- Rust
- Go
- Haskell
- Python
- Ruby
- Java
- JavaScript

## การตั้งค่าที่ควรรู้

เปิด `Settings` ของ VS Code แล้วค้นหา `Competitive Programming Helper` หรือ `TOI Zero` เพื่อปรับค่าได้ เช่น:

- `cph.general.timeOut` - เวลาหมดอายุของ testcases
- `cph.general.defaultLanguage` - ภาษาเริ่มต้นตอน import โจทย์ใหม่
- `cph.general.menuChoices` - ลำดับภาษาที่แสดงในเมนู
- `cph.language.*.Command` - คำสั่ง compiler/runtime ของแต่ละภาษา
- `toiZero.pythonPath` - path หรือ command ของ Python ที่ใช้กับ TOI Zero

## เหมาะกับใคร

- คนที่แก้โจทย์แข่งขันใน VS Code เป็นประจำ
- คนที่ต้องจัดการโจทย์ TOI Zero หลาย task พร้อมกัน
- คนที่อยากได้ทั้ง test runner และ TOI workflow ในตัวเดียว

## เครดิต

โปรเจกต์นี้อ้างอิงและต่อยอดจาก `Competitive Programming Helper` โดย `Divyanshu Agrawal`
และมีส่วนของ TOI Zero workflow ที่เชื่อมกับงานของ `PakinDioxide/TOI-zero`

## License

GPL-3.0-or-later

