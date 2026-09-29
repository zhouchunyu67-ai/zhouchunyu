import aestheticRows from "./cinematic-data/aesthetic.json";
import assetRows from "./cinematic-data/assets.json";
import cameraBodyRows from "./cinematic-data/camera-body.json";
import cameraMotionRows from "./cinematic-data/camera-motion.json";
import compositionRows from "./cinematic-data/composition.json";
import editingRows from "./cinematic-data/editing.json";
import environmentRows from "./cinematic-data/environment.json";
import filmStockRows from "./cinematic-data/film-stock.json";
import genreStyleRows from "./cinematic-data/genre-style.json";
import lensCharacterRows from "./cinematic-data/lens-character.json";
import lightingRows from "./cinematic-data/lighting.json";
import narrativeRows from "./cinematic-data/narrative.json";
import templateRows from "./cinematic-data/templates.json";
import visualEffectRows from "./cinematic-data/visual-effects.json";

export type CinematicCategory = {
  id: string;
  name: string;
  count: number;
  description: string;
};

export type CinematicEntry = {
  id: string;
  categoryId: CinematicCategory["id"];
  title: string;
  summary: string;
  template: string;
  image: string;
  imageAlt: string;
};

type SourceEntry = {
  index: number;
  title: string;
  description: string;
  prompt: string;
  img: string;
  alt: string;
};

type CategorySource = {
  id: string;
  name: string;
  description: string;
  rows: SourceEntry[];
};

const categorySources: CategorySource[] = [
  { id: "assets", name: "资产", description: "角色、场景、建筑与道具等可复用美术资产模板。", rows: assetRows },
  { id: "camera-motion", name: "摄影机运动", description: "景别、机位、运动轨迹与镜头调度的电影化表达。", rows: cameraMotionRows },
  { id: "lighting", name: "灯光", description: "主辅光、色温、光比和氛围光线的设计方向。", rows: lightingRows },
  { id: "composition", name: "构图", description: "画面重心、空间层次、视觉动线与主体关系。", rows: compositionRows },
  { id: "editing", name: "剪辑", description: "节奏、转场、蒙太奇与镜头衔接的叙事选择。", rows: editingRows },
  { id: "narrative", name: "叙事", description: "场景目标、情绪推进、视角与故事信息分配。", rows: narrativeRows },
  { id: "visual-effects", name: "视觉特效", description: "粒子、气氛、动态效果与画面强化手段。", rows: visualEffectRows },
  { id: "genre-style", name: "类型风格", description: "按类型片语汇确定整体视觉与情绪基调。", rows: genreStyleRows },
  { id: "film-stock", name: "胶片", description: "胶片色彩科学、颗粒、反差与年代质感参考。", rows: filmStockRows },
  { id: "camera-body", name: "相机机型", description: "不同摄影机系统带来的成像特征与画面倾向。", rows: cameraBodyRows },
  { id: "lens-character", name: "镜头特性", description: "焦段、变形、散景、畸变与镜头个性。", rows: lensCharacterRows },
  { id: "aesthetic", name: "美学修饰", description: "纹理、颗粒、综合色彩和后期气质的微调。", rows: aestheticRows },
  { id: "environment", name: "环境参数", description: "天气、时间与空间空气感等环境变量。", rows: environmentRows },
  { id: "templates", name: "组合模板", description: "把多个电影化参数合并使用的快捷结构。", rows: templateRows },
];

export const cinematicCategories: CinematicCategory[] = categorySources.map(({ id, name, description, rows }) => ({
  id,
  name,
  count: rows.length,
  description,
}));

export const cinematicEntries: CinematicEntry[] = categorySources.flatMap(({ id: categoryId, rows }) =>
  rows.map((row, index) => ({
    id: `${categoryId}-${String(index + 1).padStart(3, "0")}`,
    categoryId,
    title: row.title,
    summary: row.description,
    template: row.prompt,
    image: row.img,
    imageAlt: row.alt || `${row.title} 示例图`,
  })),
);

export const cinematicEntryTotal = cinematicEntries.length;
