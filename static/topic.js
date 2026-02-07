(() => {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/topic/${topicId}`);
  const threadEl = document.getElementById("thread");
  const inputEl = document.getElementById("message-input");
  const sendBtn = document.getElementById("send-message");
  const replyIndicator = document.getElementById("reply-indicator");
  const clearReply = document.getElementById("clear-reply");
  const emojiButton = document.getElementById("emoji-button");
  const emojiPanel = document.getElementById("emoji-panel");

  const storageKey = "branch.lastSeen";
  let messages = new Map();
  let replyTo = null;
  let openReplyId = null;
  let lastSeen = {};
  let lastSeenAt = null;

  const emojis = ["😀", "😂", "😊", "😉", "😍", "🤔", "😢", "😡", "👍", "👎", "❤️", "🔥"];

  const raw = localStorage.getItem(storageKey);
  if (raw) {
    try {
      lastSeen = JSON.parse(raw);
    } catch {
      lastSeen = {};
    }
  }
  lastSeenAt = lastSeen[topicId] || null;

  function saveLastSeen(isoTime) {
    if (!isoTime) return;
    lastSeenAt = isoTime;
    lastSeen[topicId] = isoTime;
    localStorage.setItem(storageKey, JSON.stringify(lastSeen));
  }

  function latestMessageTime() {
    let latest = null;
    messages.forEach((msg) => {
      if (!latest || new Date(msg.created_at) > new Date(latest)) {
        latest = msg.created_at;
      }
    });
    return latest;
  }

  function isAtBottom() {
    return window.innerHeight + window.scrollY >= document.body.offsetHeight - 40;
  }

  function scrollToBottom() {
    window.scrollTo(0, document.body.scrollHeight);
  }

  function setReply(targetId) {
    replyTo = targetId;
    replyIndicator.textContent = targetId ? `Replying to: #${targetId}` : "Replying to: none";
  }

  clearReply.addEventListener("click", () => closeReplyEditors());

  function insertAtCursor(textarea, text) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    textarea.value = value.slice(0, start) + text + value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
    textarea.focus();
  }

  function fillEmojiPanel(panel, textarea) {
    if (!panel) return;
    panel.innerHTML = "";
    emojis.forEach((emoji) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "emoji-item";
      item.textContent = emoji;
      item.addEventListener("click", () => insertAtCursor(textarea, emoji));
      panel.appendChild(item);
    });
  }

  function attachEmojiPicker(button, textarea, panel) {
    if (!button || !panel) return;
    fillEmojiPanel(panel, textarea);
    const toggle = (event) => {
      event.preventDefault();
      event.stopPropagation();
      panel.classList.toggle("open");
    };
    button.addEventListener("click", toggle);
    button.addEventListener("touchstart", toggle, { passive: false });
    button.addEventListener("pointerup", toggle);
    panel.addEventListener("click", (event) => event.stopPropagation());
    document.addEventListener("click", (event) => {
      if (!panel.contains(event.target) && event.target !== button) {
        panel.classList.remove("open");
      }
    });
  }

  function renderBody(text) {
    const regex = /(https?:\/\/[^\s]+)|(@[A-Za-z0-9_]{1,32})/g;
    const parts = text.split(regex);
    return parts.map((part) => {
      if (!part) return document.createTextNode("");
      if (part.match(/^https?:\/\//)) {
        const a = document.createElement("a");
        a.href = part;
        a.textContent = part;
        a.target = "_blank";
        a.rel = "noopener";
        return a;
      }
      if (part.startsWith("@")) {
        const name = part.slice(1);
        const span = document.createElement("span");
        span.className = "mention";
        if (name === currentUser.username) {
          span.classList.add("mention-you");
        }
        span.textContent = part;
        return span;
      }
      return document.createTextNode(part);
    });
  }

  function buildTree() {
    const nodes = new Map();
    messages.forEach((msg) => {
      nodes.set(msg.id, { ...msg, children: [] });
    });
    const roots = [];
    nodes.forEach((node) => {
      if (node.parent_id && nodes.has(node.parent_id)) {
        nodes.get(node.parent_id).children.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }

  function isUnread(node) {
    if (!lastSeenAt) return true;
    if (node.username === currentUser.username) return false;
    return new Date(node.created_at) > new Date(lastSeenAt);
  }

  function renderMessage(node) {
    const wrapper = document.createElement("div");
    wrapper.className = "message";
    wrapper.dataset.id = node.id;
    if (isUnread(node)) {
      wrapper.classList.add("unread");
    }

    const header = document.createElement("div");
    header.className = "message-header";

    const author = document.createElement("span");
    author.className = "message-author";
    author.textContent = node.username;
    author.addEventListener("click", () => insertAtCursor(inputEl, `@${node.username} `));
    header.appendChild(author);

    const meta = document.createElement("span");
    meta.className = "message-meta";
    meta.textContent = `· ${node.created_at} · #${node.id}`;
    header.appendChild(meta);
    wrapper.appendChild(header);

    const body = document.createElement("div");
    body.className = "message-body";
    renderBody(node.body).forEach((part) => body.appendChild(part));
    wrapper.appendChild(body);

    const replyBox = document.createElement("div");
    replyBox.className = "reply-editor";
    wrapper.appendChild(replyBox);

    const actions = document.createElement("div");
    actions.className = "message-actions";

    const reply = document.createElement("span");
    reply.className = "reaction";
    reply.textContent = "reply";
    reply.addEventListener("click", () => showReplyEditor(wrapper, node));
    actions.appendChild(reply);

    if (node.username === currentUser.username) {
      const edit = document.createElement("span");
      edit.className = "reaction";
      edit.textContent = "edit";
      edit.addEventListener("click", () => showEditor(wrapper, node));
      actions.appendChild(edit);
    }

    const like = document.createElement("span");
    like.className = "reaction";
    like.textContent = `+${node.likes}`;
    like.addEventListener("click", () => sendReaction(node.id, 1));
    actions.appendChild(like);

    const dislike = document.createElement("span");
    dislike.className = "reaction";
    dislike.textContent = `-${node.dislikes}`;
    dislike.addEventListener("click", () => sendReaction(node.id, -1));
    actions.appendChild(dislike);

    const toggle = document.createElement("span");
    toggle.className = "collapse-toggle";
    toggle.textContent = node.children.length ? "collapse" : "";
    toggle.addEventListener("click", () => {
      wrapper.classList.toggle("collapsed");
      toggle.textContent = wrapper.classList.contains("collapsed") ? "expand" : "collapse";
    });
    actions.appendChild(toggle);

    wrapper.appendChild(actions);

    const editor = document.createElement("div");
    editor.className = "editor";
    editor.dataset.open = "false";
    wrapper.appendChild(editor);

    if (node.children.length) {
      const childWrap = document.createElement("div");
      childWrap.className = "children";
      node.children.forEach((child) => childWrap.appendChild(renderMessage(child)));
      wrapper.appendChild(childWrap);
    }
    return wrapper;
  }

  function renderAll(shouldScroll = false) {
    threadEl.innerHTML = "";
    const roots = buildTree();
    roots.forEach((root) => threadEl.appendChild(renderMessage(root)));
    if (shouldScroll) {
      scrollToBottom();
    }
  }

  function sendMessage() {
    const body = inputEl.value.trim();
    if (!body) return;
    ws.send(JSON.stringify({ type: "new_message", body, parent_id: replyTo }));
    inputEl.value = "";
  }

  function closeReplyEditors() {
    if (!openReplyId) return;
    const openWrap = threadEl.querySelector(`.message[data-id="${openReplyId}"] .reply-editor`);
    if (openWrap) {
      openWrap.innerHTML = "";
    }
    openReplyId = null;
    setReply(null);
  }

  function showReplyEditor(wrapper, node) {
    if (openReplyId && openReplyId !== node.id) {
      closeReplyEditors();
    }
    const box = wrapper.querySelector(".reply-editor");
    if (!box) return;
    if (openReplyId === node.id) {
      closeReplyEditors();
      return;
    }
    openReplyId = node.id;
    setReply(node.id);
    box.innerHTML = "";

    const area = document.createElement("textarea");
    area.className = "reply-input";
    area.placeholder = "Reply...";
    box.appendChild(area);

    const actions = document.createElement("div");
    actions.className = "reply-actions";

    const emoji = document.createElement("button");
    emoji.type = "button";
    emoji.textContent = "Emoji";
    actions.appendChild(emoji);
    const panel = document.createElement("div");
    panel.className = "emoji-panel";
    actions.appendChild(panel);

    const send = document.createElement("button");
    send.textContent = "Send";
    send.addEventListener("click", () => {
      const body = area.value.trim();
      if (!body) return;
      ws.send(JSON.stringify({ type: "new_message", body, parent_id: node.id }));
      area.value = "";
      closeReplyEditors();
    });
    actions.appendChild(send);

    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", closeReplyEditors);
    actions.appendChild(cancel);

    box.appendChild(actions);
    attachEmojiPicker(emoji, area, panel);
    area.focus();
    area.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      if (event.ctrlKey || event.metaKey) {
        insertAtCursor(area, "\n");
        event.preventDefault();
        return;
      }
      event.preventDefault();
      send.click();
    });
  }

  function showEditor(wrapper, node) {
    const editor = wrapper.querySelector(".editor");
    if (!editor) return;
    if (editor.dataset.open === "true") {
      editor.dataset.open = "false";
      editor.innerHTML = "";
      return;
    }
    editor.dataset.open = "true";
    editor.innerHTML = "";

    const area = document.createElement("textarea");
    area.value = node.body;
    area.className = "editor-input";
    editor.appendChild(area);

    const actions = document.createElement("div");
    actions.className = "editor-actions";

    const save = document.createElement("button");
    save.textContent = "Save";
    save.addEventListener("click", () => {
      const body = area.value.trim();
      if (!body) return;
      ws.send(JSON.stringify({ type: "edit_message", message_id: node.id, body }));
      editor.dataset.open = "false";
      editor.innerHTML = "";
    });
    actions.appendChild(save);

    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      editor.dataset.open = "false";
      editor.innerHTML = "";
    });
    actions.appendChild(cancel);

    editor.appendChild(actions);
  }

  function sendReaction(messageId, value) {
    ws.send(JSON.stringify({ type: "react", message_id: messageId, value }));
  }

  attachEmojiPicker(emojiButton, inputEl, emojiPanel);

  sendBtn.addEventListener("click", sendMessage);
  inputEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (event.ctrlKey || event.metaKey) {
      insertAtCursor(inputEl, "\n");
      event.preventDefault();
      return;
    }
    event.preventDefault();
    sendMessage();
  });

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "message" || data.type === "reaction" || data.type === "edit") {
      const wasAtBottom = isAtBottom();
      messages.set(data.message.id, data.message);
      renderAll(wasAtBottom);
      if (wasAtBottom) {
        saveLastSeen(latestMessageTime());
      }
    }
  };

  ws.onopen = () => {
    initialMessages.forEach((msg) => messages.set(msg.id, msg));
    renderAll(true);
  };

  window.addEventListener("scroll", () => {
    if (isAtBottom()) {
      saveLastSeen(latestMessageTime());
    }
  });

  window.addEventListener("beforeunload", () => {
    const latest = latestMessageTime();
    if (latest) {
      saveLastSeen(latest);
    }
  });
})();
