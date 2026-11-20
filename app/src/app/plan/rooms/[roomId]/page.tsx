import { RoomPlan } from "@/components/plan/room-plan";

export default async function RoomPlanPage(
  props: PageProps<"/plan/rooms/[roomId]">,
) {
  const { roomId } = await props.params;
  return <RoomPlan roomId={roomId} />;
}
