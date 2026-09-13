export type PromptKind = "image" | "video" | "text";

export type PromptCategory = {
  id: string;
  kind: PromptKind;
  name: string;
  description: string;
  hue: number;
  sourceUrl: string;
  subjects: string[];
};

export type PromptEntry = {
  id: string;
  kind: PromptKind;
  categoryId: string;
  categoryName: string;
  title: string;
  prompt: string;
  tags: string[];
  ratio: string;
  hue: number;
  sourceUrl: string;
  index: number;
};

const imageSource = "https://image.prompt123.cn/categories.html";
const videoSource = "https://vlogprompt.com/";
const textSource = "https://www.prompt123.cn/favorites/ai-prompts/";

export const promptCategories: PromptCategory[] = [
  { id: "portrait-fashion", kind: "image", name: "人像写真", description: "肖像、自拍、情绪摄影、妆造与时尚表达", hue: 266, sourceUrl: `${imageSource}#portrait-fashion`, subjects: ["窗边自然光肖像", "雨夜街头回眸", "复古影棚半身照", "城市天台时尚大片", "清晨卧室生活照", "戏剧光影侧脸", "旅行纪实人像", "极简纯色妆面", "运动感抓拍", "黑白胶片肖像"] },
  { id: "illustration-character", kind: "image", name: "插画角色", description: "绘本、动漫、角色设定与风格化人物", hue: 326, sourceUrl: `${imageSource}#illustration-character`, subjects: ["森林邮差角色", "未来城市侦探", "东方幻想剑客", "儿童绘本伙伴", "机械修理师", "魔法学院学生", "太空旅行者", "海底王国守卫", "复古漫画女主", "治愈系动物店长"] },
  { id: "brand-product", kind: "image", name: "品牌产品", description: "产品视觉、包装、KV与商业广告", hue: 188, sourceUrl: `${imageSource}#brand-product`, subjects: ["高端护肤精华", "透明气泡饮料", "无线耳机新品", "手工香薰蜡烛", "运动鞋主视觉", "精品咖啡包装", "智能腕表广告", "天然洗护套装", "珠宝戒指特写", "户外水杯海报"] },
  { id: "narrative-scene", kind: "image", name: "场景叙事", description: "空间、故事场景与人物环境互动", hue: 215, sourceUrl: `${imageSource}#narrative-scene`, subjects: ["末班地铁站", "雨后老街早餐铺", "深夜便利店", "海边公路旅途", "雪山脚下营地", "夏日屋顶派对", "废弃剧院后台", "清晨港口码头", "沙漠中的加油站", "未来城市候车厅"] },
  { id: "nature-animal", kind: "image", name: "自然生物", description: "花卉、生态、动物与自然微观", hue: 145, sourceUrl: `${imageSource}#nature-animal`, subjects: ["晨雾中的鹿群", "雨滴上的微型花园", "深海发光水母", "雪地赤狐", "热带雨林蜂鸟", "海岸岩石潮池", "秋日银杏叶", "高山野花群落", "沙丘甲虫微距", "月光下的白狼"] },
  { id: "poster-editorial", kind: "image", name: "海报排版", description: "封面、拼贴、海报与编辑设计", hue: 24, sourceUrl: `${imageSource}#poster-editorial`, subjects: ["未来科技展海报", "独立电影节主视觉", "城市音乐现场", "咖啡文化杂志封面", "春季新品发布", "建筑摄影画册", "青年艺术展", "环保公益倡议", "潮流运动专题", "旅行城市指南"] },
  { id: "fantasy-scifi", kind: "image", name: "奇幻科幻", description: "未来主义、奇幻叙事与世界观设定", hue: 286, sourceUrl: `${imageSource}#fantasy-scifi`, subjects: ["漂浮云端城邦", "霓虹雨夜机甲", "月球温室花园", "远古巨兽遗迹", "星际列车站台", "水下未来都市", "东方神话天宫", "冰原能源基地", "沙漠量子之门", "微缩宇宙实验室"] },
  { id: "three-d-craft", kind: "image", name: "3D手作", description: "3D渲染、潮玩、纸艺与微缩材质", hue: 42, sourceUrl: `${imageSource}#three-d-craft`, subjects: ["软陶早餐店", "毛毡森林小屋", "透明树脂海岛", "纸雕城市街区", "陶瓷机器人", "积木太空基地", "黏土动物乐队", "木质机械工坊", "玻璃糖果花园", "微缩夜市摊位"] },
  { id: "information-design", kind: "image", name: "信息设计", description: "信息图、流程图与知识可视化", hue: 202, sourceUrl: `${imageSource}#information-design`, subjects: ["人工智能发展时间线", "城市公共交通地图", "咖啡风味轮", "个人理财分配图", "太阳系科普卡", "电影制作流程", "年度项目复盘", "健康睡眠指南", "品牌用户旅程", "中国传统节气图谱"] },
  { id: "history-culture", kind: "image", name: "历史文化", description: "历史考据、传统艺术与档案视觉", hue: 8, sourceUrl: `${imageSource}#history-culture`, subjects: ["宋代市井长卷", "敦煌壁画复原", "民国报刊封面", "古代航海地图", "唐代宴饮场景", "传统木版年画", "丝绸之路驿站", "明代器物图鉴", "古建筑榫卯结构", "地方非遗工艺"] },

  { id: "healing-daily", kind: "video", name: "治愈日常", description: "居家、Vlog、情侣与生活化轻剧情", hue: 164, sourceUrl: videoSource, subjects: ["清晨做早餐", "雨天在家读书", "海边散步", "猫咪陪伴工作", "周末整理房间", "黄昏骑行", "情侣一起做饭", "独居晚餐", "春日公园野餐", "深夜回家亮灯"] },
  { id: "wuxia-action", kind: "video", name: "武侠动作", description: "竹林、雨夜、兵器与江湖对决", hue: 4, sourceUrl: videoSource, subjects: ["竹林双剑对决", "雨夜屋檐追逐", "雪山拔刀", "客栈暗器突袭", "水面轻功追击", "城门长枪破阵", "峡谷弓箭伏击", "庭院徒手拆招", "落叶慢动作格挡", "火把巷战"] },
  { id: "comedy-reversal", kind: "video", name: "搞笑反转", description: "办公室、生活恶搞与结尾反转", hue: 48, sourceUrl: videoSource, subjects: ["老板突然查岗", "外卖送错房间", "相亲身份误会", "健身房逞强", "宠物偷偷拆家", "直播突然断线", "朋友假装中奖", "会议投屏翻车", "情侣互换手机", "电梯偶遇前任"] },
  { id: "oriental-fantasy", kind: "video", name: "国风仙侠", description: "古风、仙侠、敦煌与东方神话", hue: 274, sourceUrl: videoSource, subjects: ["月下御剑飞行", "敦煌飞天起舞", "山门仙鹤引路", "古城灯会遇妖", "竹简化作星河", "水墨龙破云", "桃花林剑舞", "雪夜狐仙现身", "古寺钟声唤醒石像", "天宫云海巡游"] },
  { id: "fashion-motion", kind: "video", name: "时尚人像", description: "杂志大片、人物写真与街拍镜头", hue: 318, sourceUrl: videoSource, subjects: ["雨夜霓虹街拍", "极简影棚走秀", "沙漠高定大片", "酒店走廊回眸", "海边风衣慢镜", "复古闪光灯派对", "城市天台定格", "车站胶片人像", "镜面空间舞动", "黑白侧光情绪"] },
  { id: "commerce-video", kind: "video", name: "商业广告", description: "产品展示、带货口播与品牌短片", hue: 198, sourceUrl: videoSource, subjects: ["护肤精华开箱", "咖啡豆风味展示", "运动鞋缓震测试", "智能手表功能演示", "餐厅招牌菜探店", "旅行箱耐用测试", "香水情绪广告", "耳机降噪对比", "户外冲锋衣实测", "甜品新品发布"] },

  { id: "business-writing", kind: "text", name: "商业写作", description: "方案、邮件、品牌与销售表达", hue: 210, sourceUrl: textSource, subjects: ["商业合作提案", "品牌定位说明", "产品发布邮件", "客户跟进邮件", "销售页面文案", "招商手册框架", "项目报价说明", "用户价值主张", "季度经营复盘", "市场进入策略"] },
  { id: "creative-writing", kind: "text", name: "内容创作", description: "故事、文章、选题与创意策划", hue: 290, sourceUrl: textSource, subjects: ["公众号深度文章", "人物故事采访", "品牌故事脚本", "系列栏目策划", "悬念短篇小说", "知识科普文章", "旅行随笔", "播客节目大纲", "热点评论文章", "产品幕后故事"] },
  { id: "short-copy", kind: "text", name: "短视频文案", description: "标题、口播、分镜与直播话术", hue: 12, sourceUrl: "https://prompt123.cn/tag/short-video/", subjects: ["三秒吸睛开头", "知识口播脚本", "产品种草文案", "探店短视频", "剧情反转脚本", "直播暖场话术", "短视频标题组", "评论区互动引导", "系列视频选题", "一分钟故事口播"] },
  { id: "translation-editing", kind: "text", name: "翻译润色", description: "翻译、改写、校对与语气适配", hue: 174, sourceUrl: textSource, subjects: ["中英商务翻译", "自然口语改写", "学术摘要润色", "邮件语气优化", "字幕本地化", "品牌文案转译", "合同术语校对", "新闻稿双语版", "社媒短句翻译", "长文一致性校对"] },
  { id: "data-analysis", kind: "text", name: "数据分析", description: "指标拆解、洞察、图表与报告", hue: 132, sourceUrl: textSource, subjects: ["销售趋势诊断", "用户留存分析", "广告投放复盘", "问卷结果洞察", "财务异常检查", "内容表现分析", "竞品数据对比", "漏斗转化诊断", "库存周转分析", "实验结果解读"] },
  { id: "coding-development", kind: "text", name: "编程开发", description: "需求拆解、编码、调试与评审", hue: 228, sourceUrl: textSource, subjects: ["功能需求拆解", "代码审查", "错误定位", "接口设计", "数据库结构设计", "单元测试规划", "性能优化", "重构方案", "安全风险检查", "技术文档编写"] },
  { id: "learning-research", kind: "text", name: "学习研究", description: "学习计划、论文阅读与知识总结", hue: 255, sourceUrl: textSource, subjects: ["论文快速阅读", "概念通俗解释", "考试复习计划", "知识卡片整理", "研究问题设计", "文献对比矩阵", "课程学习路线", "案例研究框架", "访谈提纲", "阶段性研究总结"] },
  { id: "workplace-office", kind: "text", name: "职场办公", description: "会议、汇报、计划与协作沟通", hue: 32, sourceUrl: textSource, subjects: ["会议纪要整理", "周报生成", "项目进度汇报", "任务优先级规划", "跨部门沟通邮件", "风险清单", "岗位交接文档", "绩效自评", "面试问题准备", "工作流程优化"] },
];

const visualStyles = [
  { label: "电影级写实", detail: "电影级真实质感，层次清晰的主次光，细腻材质与自然景深" },
  { label: "极简高级", detail: "克制留白，干净轮廓，精确版式与高级材质表现" },
  { label: "复古胶片", detail: "35mm胶片颗粒，柔和高光，轻微偏色与真实曝光波动" },
  { label: "编辑杂志", detail: "杂志编辑视觉，强构图秩序，精致色彩与可读信息层级" },
  { label: "柔和自然光", detail: "自然柔光，舒适低对比，空气感与真实环境反射" },
  { label: "戏剧光影", detail: "高反差戏剧照明，轮廓光与阴影叙事，氛围明确" },
  { label: "未来科技", detail: "未来感光源、精密细节、低饱和金属与克制霓虹" },
  { label: "东方美学", detail: "东方构图与含蓄色彩，细腻纹理，留白和诗意氛围" },
];

const videoStyles = [
  { label: "稳定跟拍", detail: "中近景稳定跟拍，人物运动方向明确，镜头保持自然惯性" },
  { label: "一镜到底", detail: "连续一镜到底，前后景遮挡完成自然转场，空间关系始终一致" },
  { label: "电影推拉", detail: "缓慢推近后轻微横移，焦点随主体动作平滑切换" },
  { label: "手持纪实", detail: "轻微手持呼吸感，真实步伐震动，抓拍式构图" },
  { label: "高速动作", detail: "快速动作与短暂慢镜交替，受力反馈清楚，避免漂浮" },
  { label: "静谧长镜", detail: "固定机位长镜头，依靠人物细节和环境变化推进情绪" },
  { label: "环绕运镜", detail: "围绕主体小幅环绕，背景产生层次视差，保持主体稳定" },
  { label: "节奏蒙太奇", detail: "三组清晰镜头按动作节点剪辑，转场由动作和声音衔接" },
];

const textStyles = [
  { label: "专业简洁", detail: "语言专业、简洁、可执行，先给结论再给依据" },
  { label: "结构化", detail: "使用清晰标题、步骤、表格或检查清单组织答案" },
  { label: "友好易懂", detail: "少用术语，用自然中文和具体例子说明复杂内容" },
  { label: "深度分析", detail: "先拆解变量和假设，再给证据、结论与限制" },
  { label: "创意发散", detail: "提供多个差异明显的方向，并说明各自适用场景" },
  { label: "结果导向", detail: "围绕目标产出可直接使用的成品，不停留在泛泛建议" },
  { label: "审慎校验", detail: "标出不确定信息、潜在风险和需要复核的关键点" },
  { label: "自然人味", detail: "避免模板腔和空话，句式有节奏，表达真诚具体" },
];

function buildImagePrompt(category: PromptCategory, subject: string, style: typeof visualStyles[number], index: number) {
  const ratios = ["1:1", "4:3", "3:4", "16:9", "9:16"];
  const ratio = ratios[index % ratios.length];
  return {
    ratio,
    prompt: `创作一张以“${subject}”为核心的${category.name}图像。视觉方向：${style.detail}。主体身份、服装、道具和环境逻辑保持一致；构图设置明确的前景、中景和背景，视觉焦点集中，边缘干净。补充真实材质、光线方向、镜头焦段与色彩关系，避免多余人物、重复肢体、错误文字、塑料质感和过度锐化。画幅 ${ratio}，输出适合直接作为高质量创作参考的完整画面。`,
  };
}

function buildVideoPrompt(category: PromptCategory, subject: string, style: typeof videoStyles[number], index: number) {
  const ratios = index % 3 === 0 ? "16:9" : "9:16";
  return {
    ratio: ratios,
    prompt: `生成一段 12 秒${category.name}视频，主题为“${subject}”。0–3 秒建立人物、环境和目标；3–8 秒完成核心动作并呈现清楚的因果与受力；8–12 秒给出情绪或剧情落点，结尾保留可衔接画面。镜头：${style.detail}。人物外观、服装、道具、左右位置和环境光连续一致；动作自然，有起势、过程和收势。加入匹配现场的环境声、动作声和必要对白，不使用无关背景音乐。避免肢体变形、物体穿模、瞬移、漂浮、镜头乱切、品牌水印和错误字幕。画幅 ${ratios}。`,
  };
}

function buildTextPrompt(category: PromptCategory, subject: string, style: typeof textStyles[number]) {
  return {
    ratio: "文本",
    prompt: `你是一名擅长${category.name}的中文专业助手。请围绕“${subject}”完成任务。表达要求：${style.detail}。开始前先识别目标、受众、使用场景、已有信息和约束；信息不足时列出最多 3 个关键假设并继续给出可用初稿。输出包含：①直接可用的最终结果；②关键思路或依据；③可替换变量；④发布或执行前检查清单。不要编造数据、来源或用户未提供的事实，不写空泛套话。`,
  };
}

export const promptEntries: PromptEntry[] = promptCategories.flatMap((category) => {
  const styles = category.kind === "image" ? visualStyles : category.kind === "video" ? videoStyles : textStyles;
  return category.subjects.flatMap((subject, subjectIndex) => styles.map((style, styleIndex) => {
    const index = subjectIndex * styles.length + styleIndex;
    const built = category.kind === "image"
      ? buildImagePrompt(category, subject, style as typeof visualStyles[number], index)
      : category.kind === "video"
        ? buildVideoPrompt(category, subject, style as typeof videoStyles[number], index)
        : buildTextPrompt(category, subject, style as typeof textStyles[number]);
    return {
      id: `${category.id}-${String(index + 1).padStart(2, "0")}`,
      kind: category.kind,
      categoryId: category.id,
      categoryName: category.name,
      title: `${subject} · ${style.label}`,
      prompt: built.prompt,
      tags: [category.name, style.label, subject],
      ratio: built.ratio,
      hue: (category.hue + styleIndex * 7) % 360,
      sourceUrl: category.sourceUrl,
      index: index + 1,
    };
  }));
});

export const promptKindLabels: Record<PromptKind, string> = {
  image: "图片提示词",
  video: "视频提示词",
  text: "文本提示词",
};
