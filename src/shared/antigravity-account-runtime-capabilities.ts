export const ANTIGRAVITY_ACCOUNTS_RUNTIME_CAPABILITY = 'accounts.antigravity-native.v1' as const
// Why separate: a host that serves the terminal accounts may predate the chat sign-in's methods.
export const ANTIGRAVITY_CHAT_SIGN_IN_RUNTIME_CAPABILITY =
  'accounts.antigravity-chat-sign-in.v1' as const

export const ANTIGRAVITY_ACCOUNT_RUNTIME_CAPABILITIES = [
  ANTIGRAVITY_ACCOUNTS_RUNTIME_CAPABILITY,
  ANTIGRAVITY_CHAT_SIGN_IN_RUNTIME_CAPABILITY
] as const
