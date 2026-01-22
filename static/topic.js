(() => {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/topic/${topicId}`);
  const threadEl = document.getElementById("thread");
  const inputEl = document.getElementById("message-input");
  const sendBtn = document.getElementById("send-message");
  const replyIndicator = document.getElementById("reply-indicator");
  const clearReply = document.getElementById("clear-reply");

  let messages = new Map();
  let replyTo = null;
  let openReplyId = null;

  function setReply(targetId) {
    replyTo = targetId;
    replyIndicator.textContent = targetId ? `Replying to: #${targetId}` : "Replying to: none";
  }

  clearReply.addEventListener("click", () => setReply(null));

  function linkify(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    return parts.map((part) => {
      if (part.match(urlRegex)) {
        const a = document.createElement("a");
        a.href = part;
        a.textContent = part;
        a.target = "_blank";
        a.rel = "noopener";
        return a;
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

  function renderMessage(node) {
    const wrapper = document.createElement("div");
    wrapper.className = "message";
    wrapper.dataset.id = node.id;

    const header = document.createElement("div");
    header.className = "message-header";
    header.textContent = `${node.username} · ${node.created_at} · #${node.id}`;
    wrapper.appendChild(header);

    const body = document.createElement("div");
    body.className = "message-body";
    linkify(node.body).forEach((part) => body.appendChild(part));
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

  function renderAll() {
    threadEl.innerHTML = "";
    const roots = buildTree();
    roots.forEach((root) => threadEl.appendChild(renderMessage(root)));
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
    area.focus();
    area.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      if (event.ctrlKey || event.metaKey) {
        const start = area.selectionStart;
        const end = area.selectionEnd;
        const value = area.value;
        area.value = value.slice(0, start) + "\n" + value.slice(end);
        area.selectionStart = area.selectionEnd = start + 1;
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

  sendBtn.addEventListener("click", sendMessage);
  inputEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (event.ctrlKey || event.metaKey) {
      const start = inputEl.selectionStart;
      const end = inputEl.selectionEnd;
      const value = inputEl.value;
      inputEl.value = value.slice(0, start) + "\n" + value.slice(end);
      inputEl.selectionStart = inputEl.selectionEnd = start + 1;
      event.preventDefault();
      return;
    }
    event.preventDefault();
    sendMessage();
  });

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "message" || data.type === "reaction" || data.type === "edit") {
      messages.set(data.message.id, data.message);
      renderAll();
    }
  };

  ws.onopen = () => {
    initialMessages.forEach((msg) => messages.set(msg.id, msg));
    renderAll();
  };
})();
