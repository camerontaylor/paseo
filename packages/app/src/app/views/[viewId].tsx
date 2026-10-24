import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { ViewScreen } from "@/views/view-screen";

export default function ViewRoute() {
  const params = useLocalSearchParams<{ viewId?: string | string[] }>();
  const viewId = Array.isArray(params.viewId) ? params.viewId[0] : params.viewId;
  return (
    <HostRouteBootstrapBoundary>
      <ViewScreen viewId={decodeURIComponent(viewId ?? "")} />
    </HostRouteBootstrapBoundary>
  );
}
