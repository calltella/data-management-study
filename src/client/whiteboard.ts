export const whiteboardToggle = `<button type="button" class="whiteboard-toggle" aria-label="ホワイトボードを別ウィンドウで開く" title="ホワイトボードを別ウィンドウで開く"><span aria-hidden="true"></span></button>`;

let whiteboardWindow: Window | null = null;

export function bindWhiteboard(panel: HTMLElement) {
  const button = panel.querySelector<HTMLButtonElement>(".whiteboard-toggle")!;
  button.onclick = () => {
    if (whiteboardWindow && !whiteboardWindow.closed) {
      whiteboardWindow.focus();
      return;
    }
    whiteboardWindow = window.open(
      "/whiteboard/index.html",
      "dm-study-whiteboard",
      "popup,width=760,height=580,resizable=yes,scrollbars=yes",
    );
    if (!whiteboardWindow) {
      window.alert("ホワイトボードを開けませんでした。このサイトのポップアップを許可してください。");
    }
  };
}
