export interface Ticket {
  id: string;
  key: string;
  title: string;
  status: string;
  url: string;
}

export interface Epic {
  id: string;
  key: string;
  title: string;
  status: string;
  url: string;
}

export interface EpicChild {
  id: string;
  key: string;
  title: string;
  status: string;
  url: string;
  assignee: string;
}

export interface MaskedToken {
  masked: true;
  last4: string;
}

export interface Settings {
  JIRA_BASE_URL: string;
  JIRA_EMAIL: string;
  JIRA_API_TOKEN: MaskedToken | null;
  JIRA_TEAM_FIELD_ID: string;
  JIRA_TEAM_ID: string;
  JIRA_ACCOUNT_ID: string;
  JIRA_PRODUCT_FIELD_ID: string;
}

export type SettingsPatch = Partial<{
  JIRA_BASE_URL: string;
  JIRA_EMAIL: string;
  JIRA_API_TOKEN: string;
  JIRA_TEAM_FIELD_ID: string;
  JIRA_TEAM_ID: string;
  JIRA_ACCOUNT_ID: string;
  JIRA_PRODUCT_FIELD_ID: string;
}>;

export interface DiscoveredId {
  id: string;
  label: string;
}

export interface DiscoveryResult {
  teamFieldId: DiscoveredId | null;
  teamId: DiscoveredId | null;
  accountId: DiscoveredId | null;
  productFieldId: DiscoveredId;
}

export interface SettingsStatus {
  claude: { available: boolean; version?: string };
  jira: { ok: boolean; error?: string };
  configured: boolean;
}

export interface ListResponse<T> {
  configured: boolean;
  items: T[];
  error?: string;
}
