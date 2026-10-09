"use client";

// 房间码统一为 6 位大写字母或数字，输入时就过滤并转大写，
// 避免小写/中文/符号一路带到服务端才被退回首页。
export function RoomCodeInput() {
  return (
    <input
      aria-label="房间码"
      autoCapitalize="characters"
      autoComplete="off"
      autoFocus
      className="room-code-input"
      maxLength={6}
      minLength={6}
      name="code"
      onChange={(event) => {
        const el = event.currentTarget;
        const caret = el.selectionStart ?? el.value.length;
        const keptBefore = el.value.slice(0, caret).replace(/[^A-Za-z0-9]/g, "").length;
        el.value = el.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
        el.setSelectionRange(keptBefore, keptBefore);
      }}
      pattern="[A-Z0-9]{6}"
      placeholder="输入房间码"
      required
    />
  );
}
