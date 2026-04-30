export type SparklineShape = {
  line: string;
  area: string;
  dotX: number | null;
  dotY: number | null;
};

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export function buildSparklineShape(
  values: number[],
  width: number,
  height: number,
  strokeWidth = 1.5,
): SparklineShape {
  if (values.length === 0) {
    return { line: "", area: "", dotX: null, dotY: null };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const cy = height / 2;

  if (values.length === 1) {
    return { line: "", area: "", dotX: round(width / 2), dotY: round(cy) };
  }

  const stepX = width / (values.length - 1);
  const points: Array<readonly [number, number]> = values.map((v, i) => {
    const x = round(i * stepX);
    const y =
      range === 0
        ? round(cy)
        : round(height - ((v - min) / range) * (height - strokeWidth) - strokeWidth / 2);
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => (i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`)).join(" ");
  const last = points[points.length - 1];
  const first = points[0];
  const area = `${line} L ${last[0]} ${height} L ${first[0]} ${height} Z`;

  return { line, area, dotX: null, dotY: null };
}
