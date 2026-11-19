// The cabin waits for the tracking camera, ascends, then docks in the final beat.
export function liftProgress(p) {
  const t = Math.max(0, Math.min(1, (p - 0.11) / 0.49));
  return t * t * (3 - 2 * t);
}

export function ignitionDemand(seconds) {
  const p = Math.max(0, Math.min(1, (seconds - 21.4) / 12.4));
  return p * p * p * (p * (p * 6 - 15) + 10);
}

export const departureCue = 98;
export const cosmicStart = 108;
export const cosmicDuration = 30;

// Distance in the two far-scale stops is interpolated continuously, including
// at the solar-system chapter boundary. This also works when scrubbing.
export function cosmicScale(seconds) {
  const t = Math.max(0, Math.min(1, (seconds - cosmicStart) / cosmicDuration));
  return 2 * t * t * (3 - 2 * t);
}

// Quiet gaps between transmissions give the audience time to read the picture.
// Cue times are local to each chapter; a seek restores the appropriate line.
export const subtitleCues = [
  [
    [1.0, 5.5, '碎石无声地掠过舷窗。'],
    [7.2, 13.5, '八光分外，地球收到太阳最后一份观测报告。'],
  ],
  [
    [1, 6.1, '保障车队已抵达。各区推进阵列，准备点火。'],
    [8.1, 15.9, '主机点火。第二阵列、第三阵列依次应答。'],
  ],
  [
    [1, 6.7, '地平线上的日出越来越慢。'],
    [8.5, 12.8, '地球停止自转。夜半球的城市仍亮着灯。'],
  ],
  [
    [0.7, 6.6, '第一班轿厢离开地面。'],
    [10.2, 14.6, '轨道港解除泊位锁定。'],
    [16.5, 22.9, '无人货船接过物资，领航站打开进港航道。'],
  ],
  [
    [2.1, 7.5, '最后一艘补给船已归港。木星正在升起。'],
    [9.1, 14.9, '近掠点通过。地球沿引力弧线加速离开。'],
  ],
  [
    [1.0, 6.4, '木星留在了身后。前方那颗红色光点，就是比邻星。'],
    [8.5, 12.6, '这一班的航程结束了。下一班，继续。'],
  ],
  [
    [3.2, 8.5, '推进束渐远。太阳和行星仍沿各自的轨道运行。'],
    [10.1, 14.2, '这就是我们离开的地方。'],
  ],
  [
    [1.5, 6.7, '再往外看，太阳只是猎户臂上的一颗星。'],
    [9.2, 13.8, '地球依然沿着那条小得几乎看不见的航线前行。'],
  ],
];

/** Story time is in seconds. Telemetry keyframes are fictional mission data.
 * Each chapter interpolates from the preceding row, including after seeking. */
export const chapters = [
  {
    title: '太阳即将熄灭',
    en: 'THE FADING SUN',
    length: 16,
    target: '太阳光球',
    copy: '碎石无声地掠过舷窗。八光分外，太阳只剩一团暗红的光。',
  },
  {
    title: '行星发动机点火',
    en: 'PLANETARY IGNITION',
    length: 22,
    target: '赤道推进阵列',
    copy: '第一列保障车抵达塔下。主机点火，远处的推进阵列依次应答。',
  },
  {
    title: '地球停止自转',
    en: 'THE LAST SUNRISE',
    length: 14,
    target: '地球自转轴',
    copy: '太阳缓缓停在地平线上。地球不再自转，夜半球的城市仍亮着灯。',
  },
  {
    title: '太空电梯启动',
    en: 'ASCENT TO ORBIT',
    length: 25,
    target: '赤道天梯枢纽',
    copy: '上行轿厢抵达轨道港。无人货船接过这一班物资，飞向领航空间站。',
  },
  {
    title: '借助木星引力弹弓加速',
    en: 'THE JOVIAN SLINGSHOT',
    length: 17,
    target: '木星近掠点',
    copy: '木星的云带占满舷窗。近掠之后，地球拐过一道长弧，带着更高的速度离开。',
  },
  {
    title: '飞向比邻星',
    en: 'BOUND FOR PROXIMA',
    length: 14,
    target: '比邻星',
    copy: '前方那颗红色光点，就是比邻星。四点二四光年的路，要用一百代人的时间走完。',
  },
  {
    title: '离开太阳系',
    en: 'BEYOND THE PLANETS',
    length: cosmicDuration / 2,
    target: '太阳系',
    copy: '地球的尾迹缩成一点。围绕太阳的轨道仍在我们身后。',
  },
  {
    title: '银河远景',
    en: 'THE MILKY WAY',
    length: cosmicDuration / 2,
    target: '银河系',
    copy: '太阳在猎户臂上只占一个光点。地球仍在向邻近的恒星前进。',
  },
];
// Each vector is [thrust %, heliocentric orbital speed km/s, distance AU,
// rotation degrees/hour, climber altitude km, signal travel seconds].
export const telemetry = [
  [0, 29.78, 1.0, 15.04, 0, 499],
  [0, 29.78, 1.0, 15.04, 0, 499],
  [96.8, 29.8, 1.002, 15.04, 0, 0.12],
  [91.4, 31.3, 1.015, 0, 0, 0.18],
  [93.8, 33.91, 1.092, 0, 35786, 0.24],
  [99.2, 46.72, 5.31, 0, 35786, 41],
  [96.5, 49.81, 39.86, 0, 35786, 133790000],
  [96.5, 49.81, 82.3, 0, 35786, 133790000],
  [96.5, 49.81, 82.3, 0, 35786, 133790000],
];
export const dossiers = {
  earth: {
    title: '地球全景',
    en: 'EARTH / MIGRATION VEHICLE',
    copy: '地球本身是这场远航的载具。昼夜交界处可以看见城市灯海、发动机阵列，以及穿过稀薄大气的赤道推进束。',
    rows: [
      ['赤道半径', '6,378 km'],
      ['目标星系', '比邻星'],
      ['规划航程', '2,500 年'],
    ],
  },
  engine: {
    title: '行星发动机',
    en: 'CN–07 / PLANETARY ENGINE',
    copy: 'CN–07 的聚变核心把工质加热成等离子体，再经磁喷管加速。塔脚的检修楼、散热器和输能管道组成一座地面推进工厂。',
    rows: [
      ['阵列位置', '赤道转向带'],
      ['供能方式', '重元素聚变'],
      ['喷流状态', '磁约束推进'],
    ],
  },
  elevator: {
    title: '太空电梯',
    en: 'EQUATORIAL SPACE ELEVATOR',
    copy: '三组主缆把地面港与轨道枢纽连成一线。上行轿厢运送物资，下行轿厢回送设备。金属缆索上的高光和航标指示了它们的运动方向。',
    rows: [
      ['上行终点', '轨道枢纽'],
      ['枢纽高度', '35,786 km'],
      ['运输方式', '双向升降'],
    ],
  },
  station: {
    title: '晨曦号空间站',
    en: 'AURORA / ORBITAL HABITAT',
    copy: '居住环绕中央对接轴缓慢旋转，为舱内提供人工重力。轴心保持定向，运输艇沿闪烁的航标接近对接口。',
    rows: [
      ['轨道高度', '418 km'],
      ['主体结构', '旋转居住环'],
      ['对接方式', '轴向交会'],
    ],
  },
  solar: {
    title: '太阳系',
    en: 'SOL / PLANETARY ORBITS',
    copy: '地球曾绕太阳公转。镜头拉远后，近邻行星与外太阳系的轨道逐次入画。示意尺寸经过压缩，用于在同一视野里辨认轨道。',
    rows: [['中心天体', '太阳'], ['主要行星', '8 颗'], ['地球平均轨道距离', '1 AU']],
  },
  galaxy: {
    title: '银河系',
    en: 'THE MILKY WAY',
    copy: '从银盘上方看，恒星和尘埃沿旋臂分布。太阳位于猎户臂，离银心约二万七千光年。',
    rows: [['类型', '棒旋星系'], ['恒星盘直径', '约 10 万光年'], ['太阳所在位置', '猎户臂']],
  },
};
