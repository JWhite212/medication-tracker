<script lang="ts">
  import { buildSparklineShape } from "$lib/utils/sparkline";

  type Props = {
    values: number[];
    color?: string;
    // When set, the SVG renders at exactly this pixel width. When
    // omitted, the SVG fills its container (responsive). The internal
    // viewBox uses this value or a default of 80 for path coordinates;
    // viewBox scales to rendered size so visual output is identical.
    width?: number;
    height?: number;
    ariaLabel?: string;
    fill?: boolean;
    strokeWidth?: number;
  };

  let {
    values,
    color = "currentColor",
    width,
    height = 24,
    ariaLabel = "Trend",
    fill = true,
    strokeWidth = 1.5,
  }: Props = $props();

  const viewBoxW = $derived(width ?? 80);
  const shape = $derived(buildSparklineShape(values, viewBoxW, height, strokeWidth));
  const sizeStyle = $derived(
    width !== undefined
      ? `width: ${width}px; height: ${height}px`
      : `width: 100%; height: ${height}px`,
  );
</script>

<svg
  role="img"
  aria-label={ariaLabel}
  viewBox="0 0 {viewBoxW} {height}"
  preserveAspectRatio="none"
  class="block"
  style={sizeStyle}
>
  {#if shape.dotX !== null && shape.dotY !== null}
    <circle cx={shape.dotX} cy={shape.dotY} r={Math.max(strokeWidth, 1.5)} fill={color} />
  {:else if shape.line}
    {#if fill}
      <path d={shape.area} fill={color} fill-opacity="0.15" stroke="none" />
    {/if}
    <path
      d={shape.line}
      fill="none"
      stroke={color}
      stroke-width={strokeWidth}
      stroke-linejoin="round"
      stroke-linecap="round"
      vector-effect="non-scaling-stroke"
    />
  {/if}
</svg>
