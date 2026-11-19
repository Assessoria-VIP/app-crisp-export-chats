function normalizeContact(meta = {}) {
  return {
    nickname: meta.nickname ?? null,
    email: meta.email ?? null,
    phone: meta.phone ?? null,
    address: meta.address ?? null,
    subject: meta.subject ?? null,
    origin: meta.origin ?? null,
    avatar: meta.avatar ?? null,
    segments: meta.segments ?? [],
    data: meta.data ?? {},
    ip: meta.ip ?? null,
    device: meta.device ?? null,
  };
}

function normalizeAssigned(assigned) {
  if (!assigned || !assigned.user_id) {
    return null;
  }

  return { user_id: assigned.user_id };
}

function normalizeAgent(user) {
  if (!user) {
    return null;
  }

  return {
    type: user.type ?? null,
    user_id: user.user_id ?? null,
    nickname: user.nickname ?? null,
  };
}

function normalizeMessage(message) {
  return {
    fingerprint: message.fingerprint ?? null,
    timestamp: message.timestamp ?? null,
    type: message.type ?? null,
    from: message.from ?? null,
    origin: message.origin ?? null,
    content: message.content ?? null,
    automated: Boolean(message.automated),
    user: normalizeAgent(message.user),
  };
}

function normalizeEvent(event) {
  return {
    text: event.text ?? null,
    data: event.data ?? null,
    color: event.color ?? null,
    timestamp: event.timestamp ?? null,
  };
}

function normalizeConversation({ conversation = {}, meta = {}, messages = [], events }) {
  const mergedMeta = { ...(conversation.meta || {}), ...meta };

  const record = {
    session_id: conversation.session_id,
    website_id: conversation.website_id,
    people_id: conversation.people_id ?? null,
    inbox_id: conversation.inbox_id ?? null,
    state: conversation.state ?? null,
    created_at: conversation.created_at ?? null,
    updated_at: conversation.updated_at ?? null,
    assigned: normalizeAssigned(conversation.assigned),
    contact: normalizeContact(mergedMeta),
    messages: messages.map(normalizeMessage),
  };

  if (events) {
    record.events = events.map(normalizeEvent);
  }

  return record;
}

module.exports = {
  normalizeConversation,
};
