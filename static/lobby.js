(() => {
  const storageKey = "branch.lastSeen";
  const raw = localStorage.getItem(storageKey);
  let lastSeen = {};
  if (raw) {
    try {
      lastSeen = JSON.parse(raw);
    } catch {
      lastSeen = {};
    }
  }

  document.querySelectorAll(".topic[data-topic-id]").forEach((topic) => {
    const topicId = topic.dataset.topicId;
    const lastActivity = topic.dataset.lastActivity;
    if (!topicId || !lastActivity) return;
    const lastSeenAt = lastSeen[topicId];
    if (!lastSeenAt) {
      topic.classList.add("unread");
      return;
    }
    if (new Date(lastActivity) > new Date(lastSeenAt)) {
      topic.classList.add("unread");
    }
  });
})();
