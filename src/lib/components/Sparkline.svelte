<script lang="ts">
  import { buildSparklineShape } from "$lib/utils/sparkline";

  type Props = {
    values: number[];
    color?: string;
    width?: number;
    height?: number;
    ariaLabel?: string;
    fill?: boolean;
    strokeWidth?: number;
  };

  let {
    values,
    color = "currentColor",
    width = 80,
    height = 24,
    ariaLabel = "Trend",
    fill = true,
    strokeWidth = 1.5,
  }: Props = $props();

  const shape = $derived(buildSparklineShape(values, width, height, strokeWidth));
</script>

<svg
  role="img"
  aria-label={ariaLabel}
  viewBox="0 0 {width} {height}"
  preserveAspectRatio="none"
  class="block"
  style="width: 100%; height: {height}px"
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
