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

export interface JiraSpaceFields {
  team?: string;
  fixVersions?: string;
  storyPoints?: string;
  sprint?: string;
  product?: string;
}

export interface JiraSpace {
  teamId: string;
  fields: JiraSpaceFields;
  discoveredAt?: string;
  error?: string;
}

export interface Settings {
  JIRA_BASE_URL: string;
  JIRA_EMAIL: string;
  JIRA_API_TOKEN: MaskedToken | null;
  JIRA_ACCOUNT_ID: string;
  JIRA_PRODUCT_FIELD_ID: string;
  JIRA_SPACES: Record<string, JiraSpace>;
}

export type SettingsPatch = Partial<{
  JIRA_BASE_URL: string;
  JIRA_EMAIL: string;
  JIRA_API_TOKEN: string;
  JIRA_ACCOUNT_ID: string;
  JIRA_PRODUCT_FIELD_ID: string;
}>;

export interface DiscoveredId {
  id: string;
  label: string;
}

export interface DiscoveryResult {
  accountId: DiscoveredId | null;
  spaces: Record<string, JiraSpace>;
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

export interface JiraProjectSummary {
  key: string;
  name: string;
}

export interface JiraProjectsResponse {
  projects: JiraProjectSummary[];
  cached: boolean;
}
