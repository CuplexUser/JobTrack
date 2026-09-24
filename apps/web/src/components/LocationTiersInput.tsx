/**
 * Preferred locations in priority levels, best first. Every place in one level counts the
 * same, and each level says what share of the location fit weight a posting there earns.
 *
 * Places are chips that drag between levels, onto "Not ranked" to unrank them, or onto the
 * drop zone below the last level to start a new one; levels reorder by their handle. A place
 * is in one level at most: typing one that is already ranked elsewhere says where it is
 * instead of adding it twice. Typing offers the known places (the Locations tab) and the
 * locations on your applications.
 *
 * A controlled form field (`value`/`onChange`), so it drops into a `Form.Item` like any input.
 * A level left without places is dropped when the profile is saved.
 */

import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DeleteOutlined, HolderOutlined, PlusOutlined } from '@ant-design/icons';
import { App as AntApp, AutoComplete, Button, Flex, InputNumber, Tag, Tooltip, Typography, theme } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  MAX_LOCATION_TIERS,
  findPlaceTier,
  locationKey,
  mergePlaces,
  movePlace,
  rankedPlaces,
  withoutPlace,
  type LocationTier,
} from '@jobtrack/shared';
import { useApplicationLocations, useKnownLocations } from '../api/hooks.js';

/** How much less a new level is worth than the one above it, by default. */
const SHARE_STEP = 25;

const UNRANKED = 'unranked';
const NEW_LEVEL = 'new-level';
type DragData = { type: 'place'; place: string } | { type: 'tier' };

/** Unique across every mounted editor; only ever compared, never shown. */
let lastTierId = 0;
const newTierId = () => `tier-${++lastTierId}`;

/** Levels reorder against the nearest level; places land on whatever is under the pointer. */
const collisions: CollisionDetection = (args) => {
  if ((args.active.data.current as DragData | undefined)?.type === 'tier') {
    return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => String(c.id).startsWith('tier-')) });
  }
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

interface Props {
  value?: LocationTier[];
  onChange?: (value: LocationTier[]) => void;
}

export function LocationTiersInput({ value, onChange }: Props) {
  const { t } = useTranslation('settings');
  const { message } = AntApp.useApp();
  const { data: known } = useKnownLocations();
  const { data: onFile } = useApplicationLocations();
  const [typed, setTyped] = useState<string[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  // Once the known list reloads (after a save, rename or removal) it is the truth again, so a
  // place typed earlier under an old spelling does not linger in "Not ranked".
  const [typedFor, setTypedFor] = useState(known);
  if (typedFor !== known) {
    setTypedFor(known);
    setTyped([]);
  }

  const tiers: LocationTier[] = useMemo(() => (value && value.length > 0 ? value : [{ places: [], share: 100 }]), [value]);

  // A stable id per level that travels with it when levels are reordered or removed. Ids
  // taken from the position would stay put while the contents moved, and dnd-kit would then
  // animate the drop a second time as every level "changed" under its id.
  const [ids, setIds] = useState<string[]>([]);
  let tierIds = ids;
  if (ids.length !== tiers.length) {
    tierIds =
      ids.length > tiers.length
        ? ids.slice(0, tiers.length)
        : [...ids, ...Array.from({ length: tiers.length - ids.length }, newTierId)];
    setIds(tierIds);
  }
  const ranked = useMemo(() => new Set(rankedPlaces(tiers).map(locationKey)), [tiers]);
  // Places typed this session count as known right away, so unranking one never loses it.
  const knownPlaces = useMemo(() => mergePlaces(known?.places ?? [], typed), [known, typed]);
  const unranked = knownPlaces.filter((place) => !ranked.has(locationKey(place)));
  const fromApplications = useMemo(() => {
    const knownKeys = new Set(knownPlaces.map(locationKey));
    return (onFile?.locations ?? []).map((option) => option.label).filter((label) => !knownKeys.has(locationKey(label)));
  }, [onFile, knownPlaces]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const update = (next: LocationTier[]) => onChange?.(next);
  const nextShare = () => Math.max(0, (tiers[tiers.length - 1]?.share ?? 100) - SHARE_STEP);

  function addPlace(raw: string, to: number): boolean {
    const place = raw.replace(/\s+/g, ' ').trim();
    if (!place) return false;
    const at = findPlaceTier(tiers, place);
    if (at === to) return true;
    if (at >= 0) {
      const ranked = tiers[at]!.places.find((p) => locationKey(p) === locationKey(place)) ?? place;
      message.warning(t('profile.locationTiers.alreadyIn', { place: ranked, level: at + 1 }));
      return false;
    }
    // Keep the spelling already known, so "stockholm" typed in lowercase adds "Stockholm".
    const spelled = knownPlaces.find((p) => locationKey(p) === locationKey(place)) ?? place;
    setTyped((current) => [...current, spelled]);
    update(movePlace(tiers, spelled, to, nextShare()));
    return true;
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as DragData | undefined;
    setDragging(data?.type === 'place' ? data.place : null);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    const data = active.data.current as DragData | undefined;
    if (!data || !over) return;
    const target = String(over.id);
    if (data.type === 'tier') {
      const from = tierIds.indexOf(String(active.id));
      const to = tierIds.indexOf(target);
      if (from < 0 || to < 0 || from === to) return;
      setIds(arrayMove(tierIds, from, to));
      // The share belongs to the priority step, not to the places: moving a group of places
      // up to priority 1 gives them priority 1's share.
      update(arrayMove(tiers, from, to).map((tier, index) => ({ ...tier, share: tiers[index]!.share })));
      return;
    }
    if (target === UNRANKED) update(withoutPlace(tiers, data.place));
    else if (target === NEW_LEVEL) {
      if (tiers.length < MAX_LOCATION_TIERS) update(movePlace(tiers, data.place, tiers.length, nextShare()));
    } else {
      const to = tierIds.indexOf(target);
      if (to >= 0 && findPlaceTier(tiers, data.place) !== to) update(movePlace(tiers, data.place, to));
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisions}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <Flex vertical gap={8}>
        <SortableContext items={tierIds} strategy={verticalListSortingStrategy}>
          {tiers.map((tier, index) => (
            <TierRow
              key={tierIds[index]}
              id={tierIds[index]!}
              index={index}
              tier={tier}
              canRemove={!(tiers.length === 1 && tier.places.length === 0)}
              suggestions={{ known: unranked, fromApplications }}
              onAdd={(place) => addPlace(place, index)}
              onUnrank={(place) => update(withoutPlace(tiers, place))}
              onShare={(share) => update(tiers.map((tr, i) => (i === index ? { ...tr, share } : tr)))}
              onRemove={() => {
                setIds(tierIds.filter((_, i) => i !== index));
                update(tiers.filter((_, i) => i !== index));
              }}
            />
          ))}
        </SortableContext>

        <NewLevelZone
          full={tiers.length >= MAX_LOCATION_TIERS}
          onAdd={() => update([...tiers, { places: [], share: nextShare() }])}
        />

        <DropBox id={UNRANKED}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {unranked.length > 0 ? t('profile.locationTiers.unrankedHint') : t('profile.locationTiers.unrankedEmpty')}
          </Typography.Text>
          {unranked.length > 0 && (
            <Flex wrap gap={4} style={{ marginTop: 6 }}>
              {unranked.map((place) => (
                <PlaceChip key={locationKey(place)} place={place} muted />
              ))}
            </Flex>
          )}
        </DropBox>
      </Flex>

      <DragOverlay dropAnimation={null}>{dragging ? <Tag style={{ cursor: 'grabbing', margin: 0 }}>{dragging}</Tag> : null}</DragOverlay>
    </DndContext>
  );
}

interface TierRowProps {
  id: string;
  index: number;
  tier: LocationTier;
  canRemove: boolean;
  suggestions: { known: string[]; fromApplications: string[] };
  onAdd: (place: string) => boolean;
  onUnrank: (place: string) => void;
  onShare: (share: number) => void;
  onRemove: () => void;
}

function TierRow({ id, index, tier, canRemove, suggestions, onAdd, onUnrank, onShare, onRemove }: TierRowProps) {
  const { t } = useTranslation('settings');
  const { token } = theme.useToken();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver, active } = useSortable({
    id,
    data: { type: 'tier' } satisfies DragData,
  });
  const placeOver = isOver && (active?.data.current as DragData | undefined)?.type === 'place';

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        border: `1px solid ${placeOver ? token.colorPrimary : token.colorBorderSecondary}`,
        background: placeOver ? token.colorPrimaryBg : token.colorFillQuaternary,
        borderRadius: token.borderRadius,
        padding: '6px 8px',
      }}
    >
      <Flex align="center" gap={8} wrap>
        <Tooltip title={t('profile.locationTiers.dragLevel')}>
          <Button
            ref={setActivatorNodeRef}
            type="text"
            size="small"
            icon={<HolderOutlined />}
            style={{ cursor: 'grab' }}
            aria-label={t('profile.locationTiers.dragLevel')}
            {...attributes}
            {...listeners}
          />
        </Tooltip>
        <Typography.Text strong style={{ minWidth: 72 }}>
          {t('profile.locationTiers.level', { level: index + 1 })}
        </Typography.Text>
        <Flex wrap gap={4} align="center" style={{ flex: '1 1 240px', minWidth: 0 }}>
          {tier.places.map((place) => (
            <PlaceChip key={locationKey(place)} place={place} onClose={() => onUnrank(place)} />
          ))}
          {tier.places.length === 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('profile.locationTiers.emptyLevel')}
            </Typography.Text>
          )}
          <PlaceInput suggestions={suggestions} onAdd={onAdd} />
        </Flex>
        <Tooltip title={t('profile.locationTiers.shareTooltip')}>
          <InputNumber
            min={0}
            max={100}
            step={5}
            suffix="%"
            size="small"
            style={{ width: 84 }}
            aria-label={t('profile.locationTiers.shareLabel', { level: index + 1 })}
            value={tier.share}
            onChange={(share) => onShare(share ?? 0)}
          />
        </Tooltip>
        <Tooltip title={t('profile.locationTiers.remove')}>
          <Button
            type="text"
            size="small"
            icon={<DeleteOutlined />}
            disabled={!canRemove}
            aria-label={t('profile.locationTiers.remove')}
            onClick={onRemove}
          />
        </Tooltip>
      </Flex>
    </div>
  );
}

/** Autocomplete for adding a place to one level. Enter adds whatever was typed. */
function PlaceInput({ suggestions, onAdd }: { suggestions: TierRowProps['suggestions']; onAdd: (place: string) => boolean }) {
  const { t } = useTranslation('settings');
  const [text, setText] = useState('');
  const needle = locationKey(text);
  const matching = (list: string[]) => list.filter((place) => !needle || locationKey(place).includes(needle)).slice(0, 30);
  const known = matching(suggestions.known);
  const onFile = matching(suggestions.fromApplications);
  const options = [
    ...(known.length > 0 ? [{ label: t('profile.locationTiers.knownGroup'), options: known.map((p) => ({ value: p, label: p })) }] : []),
    ...(onFile.length > 0 ? [{ label: t('profile.locationTiers.applicationsGroup'), options: onFile.map((p) => ({ value: p, label: p })) }] : []),
  ];

  // Enter with a highlighted suggestion fires onSelect; this tells the key handler, which runs
  // alongside it, not to also add the half-typed text.
  const selected = useRef(false);
  const submit = (place: string) => {
    if (onAdd(place)) setText('');
  };

  return (
    <AutoComplete
      size="small"
      value={text}
      options={options}
      onChange={setText}
      defaultActiveFirstOption={false}
      onSelect={(place: string) => {
        selected.current = true;
        submit(place);
      }}
      onInputKeyDown={(event) => {
        if (event.key !== 'Enter' || !text.trim()) return;
        event.preventDefault();
        selected.current = false;
        const typed = text;
        setTimeout(() => {
          if (!selected.current) submit(typed);
        }, 0);
      }}
      placeholder={t('profile.locationTiers.addPlace')}
      style={{ width: 170 }}
      popupMatchSelectWidth={220}
      aria-label={t('profile.locationTiers.addPlace')}
    />
  );
}

function PlaceChip({ place, muted, onClose }: { place: string; muted?: boolean; onClose?: () => void }) {
  const { t } = useTranslation('settings');
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `place:${locationKey(place)}`,
    data: { type: 'place', place } satisfies DragData,
  });
  return (
    <Tag
      ref={setNodeRef}
      closable={Boolean(onClose)}
      onClose={(event) => {
        event.preventDefault();
        onClose?.();
      }}
      closeIcon={onClose ? <span aria-label={t('profile.locationTiers.unrank', { place })}>×</span> : undefined}
      variant={muted ? 'filled' : 'outlined'}
      style={{ cursor: 'grab', margin: 0, opacity: isDragging ? 0.4 : 1, touchAction: 'none', userSelect: 'none' }}
      {...attributes}
      {...listeners}
    >
      {place}
    </Tag>
  );
}

/** Dashed target below the last level: drop a place here to rank it in a new, lower level. */
function NewLevelZone({ full, onAdd }: { full: boolean; onAdd: () => void }) {
  const { t } = useTranslation('settings');
  return (
    <DropBox id={NEW_LEVEL} dashed disabled={full}>
      <Flex align="center" justify="space-between" gap={8} wrap>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {full ? t('profile.locationTiers.full', { max: MAX_LOCATION_TIERS }) : t('profile.locationTiers.newLevelDrop')}
        </Typography.Text>
        <Button size="small" icon={<PlusOutlined />} disabled={full} onClick={onAdd}>
          {t('profile.locationTiers.add')}
        </Button>
      </Flex>
    </DropBox>
  );
}

function DropBox({ id, dashed, disabled, children }: { id: string; dashed?: boolean; disabled?: boolean; children: ReactNode }) {
  const { token } = theme.useToken();
  const { setNodeRef, isOver, active } = useDroppable({ id, disabled });
  const placeOver = isOver && (active?.data.current as DragData | undefined)?.type === 'place';
  return (
    <div
      ref={setNodeRef}
      style={{
        border: `1px ${dashed ? 'dashed' : 'solid'} ${placeOver ? token.colorPrimary : token.colorBorderSecondary}`,
        background: placeOver ? token.colorPrimaryBg : undefined,
        borderRadius: token.borderRadius,
        padding: '6px 10px',
      }}
    >
      {children}
    </div>
  );
}
