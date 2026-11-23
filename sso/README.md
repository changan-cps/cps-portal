# CPS SSO — login ครั้งเดียวที่ Portal เข้าได้ทุกแอป

ระบบกลางสำหรับ CPS Digital Platform: เก็บผู้ใช้ รหัสผ่าน แอป และสิทธิ์ไว้ที่ Google Apps Script
ตั้งสิทธิ์ที่ Portal ที่เดียว แอปอื่นรับสิทธิ์ผ่าน "บัตรผ่าน" (ticket) อายุ 2 นาทีที่เซ็นด้วยรหัสลับร่วม

| ส่วน | ไฟล์ | หน้าที่ |
|---|---|---|
| SSO กลาง | `sso/Code.gs` | login, เก็บข้อมูล, ออกบัตรผ่าน |
| Portal | `index.html` + `sso.json` | มี `sso.json` = ใช้ SSO · ไม่มี = โหมดเดิม (config.json) |
| ตัวกั้น | `sso-gate.js` | ใส่ในแอปบน github.io ให้เข้าได้เฉพาะคน login Portal ที่มีสิทธิ์ |
| PJO Audit / AI Audit | branch `cps-sso` ของแต่ละ repo | รับบัตรผ่าน สร้าง/อัปเดตผู้ใช้ตามบทบาทจาก Portal ปิดหน้า login เดิม |
| Lean Quest / IE Digital | branch `cps-sso` ของแต่ละ repo | ใส่ตัวกั้น |

## ขั้นตอนเปิดใช้ (ทำตามลำดับ)

### 1. สร้าง SSO กลาง
1. เปิด https://script.new ด้วยบัญชี Google เดียวกับที่ deploy PJO Audit / AI Audit → ตั้งชื่อโปรเจกต์ `CPS SSO`
2. ลบโค้ดเดิม แล้ววางเนื้อหาไฟล์ `sso/Code.gs` ทั้งหมด → กดบันทึก
3. **Deploy ▸ New deployment ▸ Web app** — Execute as: **Me** · Who has access: **Anyone** → Deploy → อนุญาตสิทธิ์
4. คัดลอก **Web app URL** (ลงท้าย `/exec`) เก็บไว้
5. เลือกฟังก์ชัน `showSecret` แล้วกด **Run** → ดู Execution log → คัดลอกค่า `SSO_SECRET` (อย่าเผยแพร่ค่านี้)

### 2. PJO Audit (Apps Script)
1. เปิดโปรเจกต์ Apps Script ของ PJO Audit → **Project Settings ▸ Script properties** → เพิ่ม `SSO_SECRET` = ค่าจากข้อ 1.5
2. แทนที่ `Code.gs` และ `Index.html` ด้วยไฟล์จาก repo `cps-pjo-audit` branch `cps-sso` โฟลเดอร์ `apps-script/dist/`
3. **Deploy ▸ Manage deployments ▸ ✏️ Edit ▸ Version: New version ▸ Deploy** (URL เดิมไม่เปลี่ยน)

### 3. AI Audit (Apps Script)
1. เพิ่ม Script property `SSO_SECRET` ค่าเดียวกัน
2. แทนที่ `Code.gs` และ `index.html` ด้วยไฟล์จาก repo `Healthcheck` branch `cps-sso` โฟลเดอร์ `bundle/` (หรือ `npm run push` ถ้าใช้ clasp)
3. Deploy เวอร์ชันใหม่แบบเดียวกับข้อ 2.3

### 4. เปิด SSO ที่ Portal
1. merge branch `cps-sso` ของ 4 repo (cps-pjo-audit, Healthcheck, lean-quest, IE-Digital-Program) เข้า `main`
2. เพิ่มไฟล์ `sso.json` ใน repo `cps-portal`: `{"url": "<Web app URL จากข้อ 1.4>"}`
3. เปิด Portal → สร้างบัญชี Admin ใหม่ (รายการแอปเดิมถูกนำเข้าให้อัตโนมัติ) → เพิ่มผู้ใช้และตั้งสิทธิ์
   - PJO Audit / AI Audit: เลือก **บทบาท** ในตารางสิทธิ์ (ตัวแรก = สิทธิ์สูงสุด)

## ควรรู้
- ชื่อผู้ใช้ใน Portal จะถูกใช้เป็นชื่อผู้ใช้ใน PJO Audit / AI Audit (ตัวพิมพ์เล็ก) ถ้าต้องการให้ข้อมูลเก่าตามมา ให้ตั้งชื่อผู้ใช้ใน Portal ให้ตรงกับชื่อเดิมในแอป
- บทบาทที่ตั้งใน Portal จะทับบทบาทในแอปตอนเข้าครั้งถัดไป (ถ้าบทบาทตรงกัน รายละเอียดราย Workshop ใน PJO Audit จะคงไว้)
- **ฉุกเฉิน** (SSO ล่ม): ตั้ง Script property `ALLOW_LOCAL_LOGIN` = `true` ในแอปนั้น หน้า login เดิมจะกลับมา
- ปิด SSO ทั้งระบบ: ลบ `sso.json` ออกจาก repo cps-portal → Portal กลับไปใช้ config.json และตัวกั้นหยุดทำงาน
- ตัวกั้นของ Lean Quest / IE Digital เป็นการล็อกฝั่งเบราว์เซอร์บนเว็บสาธารณะ กันผู้ใช้ทั่วไปได้ แต่โค้ดของแอปยังอยู่ใน repo สาธารณะ
- Lean Quest: ผู้เล่นทุกคน (รวมผู้เข้าอบรมที่สแกนเข้าห้อง) ต้องมีบัญชี Portal ที่มีสิทธิ์ Lean Quest

## ทดสอบ
```
node --test sso/test/sso.test.js      # SSO กลาง
node sso/sim.js 8124                  # จำลอง server ในเครื่อง แล้วสร้าง sso.json = {"url":"http://localhost:8124/"}
```
