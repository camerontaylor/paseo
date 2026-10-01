import Svg, { Circle, Path } from "react-native-svg";
import type { LinearIssue } from "@getpaseo/protocol/linear";

/** Linear's workflow glyphs: started states advance by their order within the team. */
export function LinearStatusIcon({
  state,
  size = 16,
}: {
  state: LinearIssue["state"];
  size?: number;
}) {
  const { color, type, progress } = state;
  const filled = ["completed", "canceled", "duplicate", "triage"].includes(type);
  const angle = Math.max(0, Math.min(progress, 1)) * Math.PI * 2;
  const x = 12 + 6 * Math.sin(angle);
  const y = 12 - 6 * Math.cos(angle);
  const wedge = `M12 12 L12 6 A6 6 0 ${angle > Math.PI ? 1 : 0} 1 ${x} ${y} Z`;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Circle
        cx={12}
        cy={12}
        r={9}
        stroke={color}
        strokeWidth={2.3}
        fill={filled ? color : "none"}
        strokeDasharray={type === "backlog" ? "2.5 2.5" : undefined}
      />
      {type === "started" && progress > 0 ? <Path d={wedge} fill={color} /> : null}
      {type === "completed" ? (
        <Path d="m7 12 3.2 3.2L17 8.5" stroke="white" strokeWidth={2.2} fill="none" />
      ) : null}
      {type === "canceled" ? <Path d="m8 8 8 8m0-8-8 8" stroke="white" strokeWidth={2.2} /> : null}
      {type === "duplicate" ? (
        <Path d="m7 13 6-6m-2 10 6-6" stroke="white" strokeWidth={2.2} />
      ) : null}
      {type === "triage" ? (
        <Path d="M4 11h4V8l4 4-4 4v-3H4m16-2h-4V8l-4 4 4 4v-3h4" fill="white" />
      ) : null}
    </Svg>
  );
}
