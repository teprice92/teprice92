/* Fleet Command — static game data: ship classes, abilities and maps. */
(function (FC) {
  'use strict';

  // Each ability belongs to one ship class and is lost when every ship of
  // that class has been sunk. `ends` = using it finishes your turn.
  // target: 'enemy' (tap enemy waters), 'own' (tap your waters), 'none'.
  FC.ABILITIES = {
    air:    { name: 'Air Strike',      cost: 5, ends: true,  target: 'enemy', rotate: true,
              desc: 'Bombers hit 5 cells in a straight line.' },
    cross:  { name: 'Cross Barrage',   cost: 3, ends: true,  target: 'enemy', rotate: false,
              desc: 'Heavy guns hit a plus-shaped group of 5 cells.' },
    doom:   { name: 'Doomsday Salvo',  cost: 8, ends: true,  target: 'enemy', rotate: false,
              desc: 'Saturates a full 3×3 area. Save up for this one.' },
    sonar:  { name: 'Sonar Ping',      cost: 2, ends: false, target: 'enemy', rotate: false,
              desc: 'Scans a 3×3 area and marks hidden ship contacts. Free action.' },
    torp:   { name: 'Torpedo Run',     cost: 3, ends: true,  target: 'enemy', rotate: true,
              desc: 'Runs down a row (or column) and hits the first intact hull it meets.' },
    hunter: { name: 'Hunter Torpedo',  cost: 4, ends: true,  target: 'none',  rotate: false,
              desc: 'Homing torpedo: guaranteed hit on a random intact enemy hull.' },
    shield: { name: 'Aegis Shield',    cost: 3, ends: false, target: 'own',   rotate: false,
              desc: 'Shields a 3×3 area of your waters until your next turn. Free action.' },
    repair: { name: 'Damage Control',  cost: 4, ends: false, target: 'own',   rotate: false,
              desc: 'Repairs one damaged hull section on a ship still afloat. Free action.' },
    mine:   { name: 'Deploy Mine',     cost: 2, ends: false, target: 'own',   rotate: false,
              desc: 'Hides a mine in your empty water. Whoever shoots it takes a hit back. Free action.' },
    quick:  { name: 'Quick Shot',      cost: 2, ends: false, target: 'enemy', rotate: false,
              desc: 'Fire one bonus shot without ending your turn.' },
    recon:  { name: 'Recon Flight',    cost: 2, ends: false, target: 'enemy', rotate: true,
              desc: 'A scout plane counts the intact hull cells in one row (or column). Free action.' },
    swarm:  { name: 'Missile Swarm',   cost: 5, ends: true,  target: 'enemy', rotate: false,
              desc: '4 missiles strike random un-shot cells in a 5×5 area.' }
  };

  // size = cells on the board, pts = fleet budget cost.
  FC.SHIPS = {
    CV: { name: 'Carrier',       size: 5, pts: 5, ability: 'air',    hull: '#7d8b99' },
    BB: { name: 'Battleship',    size: 4, pts: 4, ability: 'cross',  hull: '#83909c' },
    DN: { name: 'Dreadnought',   size: 5, pts: 7, ability: 'doom',   hull: '#6f7884' },
    CA: { name: 'Cruiser',       size: 3, pts: 3, ability: 'sonar',  hull: '#8b98a3' },
    DD: { name: 'Destroyer',     size: 2, pts: 2, ability: 'torp',   hull: '#909ca6' },
    SS: { name: 'Submarine',     size: 3, pts: 3, ability: 'hunter', hull: '#4f5a63' },
    AE: { name: 'Aegis Cruiser', size: 3, pts: 3, ability: 'shield', hull: '#8796a4' },
    RT: { name: 'Repair Tender', size: 3, pts: 3, ability: 'repair', hull: '#97a19a' },
    ML: { name: 'Minelayer',     size: 2, pts: 2, ability: 'mine',   hull: '#86918a' },
    PT: { name: 'Patrol Boat',   size: 2, pts: 2, ability: 'quick',  hull: '#a0a9b1' },
    CO: { name: 'Corvette',      size: 2, pts: 2, ability: 'recon',  hull: '#949fa9' },
    AR: { name: 'Arsenal Ship',  size: 4, pts: 4, ability: 'swarm',  hull: '#7a8590' }
  };
  FC.SHIP_ORDER = ['CV', 'BB', 'DN', 'CA', 'DD', 'SS', 'AE', 'RT', 'ML', 'PT', 'CO', 'AR'];
  FC.CLASSIC_FLEET = ['CV', 'BB', 'CA', 'SS', 'DD'];

  FC.RULES = {
    cpPerTurn: 1,
    cpPerSink: 2,
    cpMax: 10,
    maxPerClass: 2,
    minShips: 3,
    maxShips: 6
  };

  // Terrain: '#' = island/reef (can't place ships or shoot there).
  // event: random hazard that strikes both fleets every `every` rounds.
  FC.MAPS = [
    {
      id: 'open', name: 'Open Ocean', size: 10, budget: 18,
      blurb: 'Classic 10×10 open water. No tricks, just tactics.',
      sea: ['#0b3954', '#062236'], terrain: null
    },
    {
      id: 'arch', name: 'Archipelago', size: 12, budget: 22,
      blurb: 'Islands break up the sea lanes. Hide your fleet behind them.',
      sea: ['#0d5c63', '#06323a'],
      terrain: [
        '............',
        '..##........',
        '..#.......#.',
        '..........##',
        '.....##.....',
        '.....##.....',
        '............',
        '.#..........',
        '.##.....##..',
        '........#...',
        '............',
        '............'
      ]
    },
    {
      id: 'mines', name: 'Minefield Strait', size: 11, budget: 20,
      blurb: 'Each side hides 4 old sea mines. Shoot one and it blasts the cells around it.',
      sea: ['#1d4e5f', '#0b2733'], terrain: null, seaMines: 4
    },
    {
      id: 'storm', name: 'Storm Front', size: 10, budget: 18,
      blurb: 'Lightning strikes a random cell in both fleets every 3 rounds.',
      sea: ['#26384a', '#0d1621'], terrain: null,
      event: { kind: 'lightning', every: 3, name: 'Lightning strike' }
    },
    {
      id: 'deep', name: "Kraken's Deep", size: 14, budget: 27,
      blurb: 'A huge abyss with reefs. The Kraken grabs a random cell in both fleets every 4 rounds.',
      sea: ['#102a4c', '#050d1c'],
      terrain: [
        '..............',
        '..............',
        '...#......#...',
        '..............',
        '..............',
        '......##......',
        '.....#..#.....',
        '.....#..#.....',
        '......##......',
        '..............',
        '..............',
        '...#......#...',
        '..............',
        '..............'
      ],
      event: { kind: 'kraken', every: 4, name: 'Kraken attack' }
    }
  ];
  FC.mapById = function (id) {
    return FC.MAPS.find(function (m) { return m.id === id; }) || FC.MAPS[0];
  };

  FC.colName = function (x) { return String.fromCharCode(65 + x); };
  FC.cellName = function (i, size) {
    return FC.colName(i % size) + (Math.floor(i / size) + 1);
  };
})(window.FC = window.FC || {});
