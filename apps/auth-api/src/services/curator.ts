type CuratorUser = {
  id: number;
  name: string;
  full_name: string;
  email: string;
};

type CuratorGroup = {
  frontend_group_id: number;
  name: string;
  users: Array<{
    frontend_user_id: number;
    name: string;
    source?: string;
  }>;
};

export async function getCuratorUserByToken(token: string): Promise<CuratorUser> {
  const baseUrl = process.env.CURATOR_BASE_URL;
  const apiKey = process.env.CURATOR_API_KEY;

  if (!baseUrl) throw new Error("CURATOR_BASE_URL is not set");
  if (!apiKey) throw new Error("CURATOR_API_KEY is not set");

  const url = `${baseUrl}/api/v1/User/getUser?apikey=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}`;

  const res = await fetch(url, { method: "GET" });

  if (!res.ok) {
    throw new Error(`Curator getUser failed: ${res.status}`);
  }

  const data = await res.json();

  if (!data.user?.id) {
    throw new Error("Curator getUser response does not contain user.id");
  }

  return data.user as CuratorUser;
}

export async function listCuratorGroups(): Promise<CuratorGroup[]> {
  const baseUrl = process.env.CURATOR_BASE_URL;
  const apiKey = process.env.CURATOR_API_KEY;

  if (!baseUrl) throw new Error("CURATOR_BASE_URL is not set");
  if (!apiKey) throw new Error("CURATOR_API_KEY is not set");

  const url = `${baseUrl}/api/v1/User/listGroups?apikey=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, { method: "GET" });

  if (!res.ok) {
    throw new Error(`Curator listGroups failed: ${res.status}`);
  }

  const data = await res.json();

  if (!Array.isArray(data)) {
    throw new Error("Curator listGroups response is not an array");
  }

  return data as CuratorGroup[];
}

export async function getGroupsForCuratorUser(userId: number): Promise<CuratorGroup[]> {
  const groups = await listCuratorGroups();

  return groups.filter((group) =>
    group.users.some((user) => user.frontend_user_id === userId)
  );
}
