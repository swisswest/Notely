import type { Label } from '@/types';

interface LabelChipProps {
  label: Label;
  active?: boolean;
  onClick?: () => void;
  title?: string;
}

export function LabelChip({ label, active = true, onClick, title }: LabelChipProps) {
  const content = (
    <>
      <span className="label-chip__dot" />
      {label.name}
    </>
  );

  if (!onClick) {
    return (
      <span className="label-chip" data-color={label.color} data-active={active} title={title}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="label-chip"
      data-color={label.color}
      data-active={active}
      data-interactive="true"
      title={title ?? label.name}
      onClick={onClick}
    >
      {content}
    </button>
  );
}

export function LabelDots({ labels }: { labels: Label[] }) {
  if (labels.length === 0) return null;
  return (
    <span className="label-dots">
      {labels.map((label) => (
        <span key={label.id} className="label-chip__dot" data-color={label.color} title={label.name} />
      ))}
    </span>
  );
}
