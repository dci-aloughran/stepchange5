import type {
  AccessibilityNeed,
  AccessibilityNeedInput,
  CreateHome,
  CreatePerson,
  CreatePossession,
  CreateRoom,
  Home,
  HomeListItem,
  Household,
  Person,
  Possession,
  Room,
  RoomDetail,
  TasteProfile,
  UpdateAccessibilityNeed,
  UpdateHome,
  UpdateHousehold,
  UpdatePerson,
  UpdatePossession,
  UpdateRoom,
  UpdateUserProfile,
  UserProfile,
} from "@stepchange/shared";
import { ApiError, readJson, type useServer } from "../server";

// The server operations the journey sync needs. Kept as an interface so the
// sync logic can be exercised with a fake in tests.
export interface JourneyApi {
  listHomes(): Promise<HomeListItem[]>;
  getHome(id: string): Promise<Home | null>;
  createHome(body: CreateHome): Promise<Home>;
  updateHome(id: string, body: UpdateHome): Promise<Home>;
  getProfile(): Promise<UserProfile>;
  patchProfile(body: UpdateUserProfile): Promise<UserProfile>;
  getHousehold(): Promise<Household>;
  putHousehold(body: UpdateHousehold): Promise<Household>;
  listPersons(): Promise<Person[]>;
  createPerson(body: CreatePerson): Promise<Person>;
  updatePerson(id: string, body: UpdatePerson): Promise<Person>;
  deletePerson(id: string): Promise<void>;
  listNeeds(): Promise<AccessibilityNeed[]>;
  createNeed(body: AccessibilityNeedInput): Promise<AccessibilityNeed>;
  updateNeed(
    id: string,
    body: UpdateAccessibilityNeed,
  ): Promise<AccessibilityNeed>;
  deleteNeed(id: string): Promise<void>;
  listPossessions(): Promise<Possession[]>;
  createPossession(body: CreatePossession): Promise<Possession>;
  updatePossession(id: string, body: UpdatePossession): Promise<Possession>;
  deletePossession(id: string): Promise<void>;
  listRooms(homeId: string): Promise<Room[]>;
  createRoom(homeId: string, body: CreateRoom): Promise<RoomDetail>;
  updateRoom(
    homeId: string,
    roomId: string,
    body: UpdateRoom,
  ): Promise<RoomDetail>;
  deleteRoom(homeId: string, roomId: string): Promise<void>;
  reviewRoom(homeId: string, roomId: string): Promise<RoomDetail>;
  getTaste(): Promise<TasteProfile | null>;
}

type Client = ReturnType<typeof useServer>["client"];

async function noContent(res: Response): Promise<void> {
  if (res.ok || res.status === 404) return;
  await readJson(res);
}

async function orNull<T>(p: Promise<Response>): Promise<T | null> {
  const res = await p;
  if (res.status === 404) return null;
  return readJson<T>(res);
}

export function isNotFound(e: unknown) {
  return e instanceof ApiError && e.status === 404;
}

export function journeyApi(client: Client): JourneyApi {
  const p = client.profile;
  const homes = client.homes;
  return {
    listHomes: async () => readJson(await homes.$get()),
    getHome: async (homeId) => {
      const detail = await orNull<{ home: Home }>(
        homes[":homeId"].$get({ param: { homeId } }),
      );
      return detail?.home ?? null;
    },
    createHome: async (json) => readJson(await homes.$post({ json })),
    updateHome: async (homeId, json) =>
      readJson(await homes[":homeId"].$patch({ param: { homeId }, json })),
    getProfile: async () => readJson(await p.me.$get()),
    patchProfile: async (json) => readJson(await p.me.$patch({ json })),
    getHousehold: async () => readJson(await p.household.$get()),
    putHousehold: async (json) => readJson(await p.household.$put({ json })),
    listPersons: async () => readJson(await p.persons.$get()),
    createPerson: async (json) => readJson(await p.persons.$post({ json })),
    updatePerson: async (personId, json) =>
      readJson(await p.persons[":personId"].$patch({ param: { personId }, json })),
    deletePerson: async (personId) =>
      noContent(await p.persons[":personId"].$delete({ param: { personId } })),
    listNeeds: async () => readJson(await p.accessibility.$get()),
    createNeed: async (json) => readJson(await p.accessibility.$post({ json })),
    updateNeed: async (needId, json) =>
      readJson(
        await p.accessibility[":needId"].$patch({ param: { needId }, json }),
      ),
    deleteNeed: async (needId) =>
      noContent(await p.accessibility[":needId"].$delete({ param: { needId } })),
    listPossessions: async () => readJson(await p.possessions.$get()),
    createPossession: async (json) =>
      readJson(await p.possessions.$post({ json })),
    updatePossession: async (possessionId, json) =>
      readJson(
        await p.possessions[":possessionId"].$patch({
          param: { possessionId },
          json,
        }),
      ),
    deletePossession: async (possessionId) =>
      noContent(
        await p.possessions[":possessionId"].$delete({
          param: { possessionId },
        }),
      ),
    listRooms: async (homeId) =>
      readJson(await homes[":homeId"].rooms.$get({ param: { homeId } })),
    createRoom: async (homeId, json) =>
      readJson(await homes[":homeId"].rooms.$post({ param: { homeId }, json })),
    updateRoom: async (homeId, roomId, json) =>
      readJson(
        await homes[":homeId"].rooms[":roomId"].$patch({
          param: { homeId, roomId },
          json,
        }),
      ),
    deleteRoom: async (homeId, roomId) =>
      noContent(
        await homes[":homeId"].rooms[":roomId"].$delete({
          param: { homeId, roomId },
        }),
      ),
    reviewRoom: async (homeId, roomId) =>
      readJson(
        await homes[":homeId"].rooms[":roomId"].review.$post({
          param: { homeId, roomId },
        }),
      ),
    getTaste: async () => {
      const body = await readJson<{ profile: TasteProfile | null }>(
        await client.taste.$get(),
      );
      return body.profile;
    },
  };
}
