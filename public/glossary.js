// Strict definitions of game terms, shown when a player taps an underlined word. Based on the
// Glossary of the official Blood on the Clocktower rulebook, adapted to how this app plays
// (there is no human Storyteller here: the app does the Storyteller's job).
//
// `match` lists every word form to underline, per language (case-insensitive, whole words).
// Only the first occurrence of each term in a block of text is underlined, to keep it readable.

const GLOSSARY = [
  {
    id: 'demon',
    en: {
      title: 'Demon',
      def: 'A type of character that begins evil. There is exactly one Demon in play (in this edition, the Imp). If the Demon dies, the good team wins — unless the Scarlet Woman takes their place. The Demon usually kills a player each night, except the first.',
      match: ['demon', 'demons'],
    },
    fr: {
      title: 'Démon',
      def: "Un type de personnage qui commence maléfique. Il y a exactement un Démon en jeu (dans cette édition, le Diablotin). Si le Démon meurt, le camp du Bien gagne — sauf si la Femme écarlate prend sa place. Le Démon tue en général un joueur chaque nuit, sauf la première.",
      match: ['démon', 'démons'],
    },
  },
  {
    id: 'minion',
    en: {
      title: 'Minion',
      def: 'A type of character that begins evil. Minions have abilities that help the evil team. There are usually 1 to 3 Minions per game. With 7 or more players, the Minions learn who the Demon is on the first night.',
      match: ['minion', 'minions'],
    },
    fr: {
      title: 'Sbire',
      def: "Un type de personnage qui commence maléfique. Les Sbires ont des capacités qui aident le camp du Mal. Il y a en général 1 à 3 Sbires par partie. À partir de 7 joueurs, les Sbires apprennent qui est le Démon lors de la première nuit.",
      match: ['sbire', 'sbires', 'sbire(s)'],
    },
  },
  {
    id: 'townsfolk',
    en: {
      title: 'Townsfolk',
      def: 'A type of good character. Townsfolk have abilities that help the good team. Usually, most characters in play are Townsfolk.',
      match: ['townsfolk'],
    },
    fr: {
      title: 'Villageois',
      def: "Un type de personnage bon. Les Villageois ont des capacités qui aident le camp du Bien. En général, la plupart des personnages en jeu sont des Villageois.",
      match: ['villageois'],
    },
  },
  {
    id: 'outsider',
    en: {
      title: 'Outsider',
      def: 'A type of character that begins good. Outsiders have abilities that are unhelpful to the good team (for example the Saint, who loses the game for good if executed).',
      match: ['outsider', 'outsiders'],
    },
    fr: {
      title: 'Marginal',
      def: "Un type de personnage qui commence bon. Les Marginaux ont des capacités qui nuisent au camp du Bien (par exemple le Saint, qui fait perdre son camp s'il est exécuté).",
      match: ['marginal', 'marginaux'],
    },
  },
  {
    id: 'good',
    en: {
      title: 'Good',
      def: 'The good alignment. Townsfolk and Outsiders start good. Good wins when the Demon dies. All good players win together, dead or alive.',
      match: ['good'],
    },
    fr: {
      title: 'Bien (bon)',
      def: "L'alignement bon. Les Villageois et les Marginaux commencent bons. Le Bien gagne quand le Démon meurt. Tous les joueurs bons gagnent ensemble, morts ou vivants.",
      match: ['le bien', 'bon', 'bons', 'bonne'],
    },
  },
  {
    id: 'evil',
    en: {
      title: 'Evil',
      def: 'The evil alignment. Minions and the Demon start evil. Evil wins when only 2 players are left alive. All evil players win together, dead or alive.',
      match: ['evil'],
    },
    fr: {
      title: 'Mal (maléfique)',
      def: "L'alignement maléfique. Les Sbires et le Démon commencent maléfiques. Le Mal gagne quand il ne reste que 2 joueurs en vie. Tous les joueurs maléfiques gagnent ensemble, morts ou vivants.",
      match: ['le mal', 'maléfique', 'maléfiques'],
    },
  },
  {
    id: 'ability',
    en: {
      title: 'Ability',
      def: "A character's special power or penalty, as written on their character. A player has no ability while dead, drunk or poisoned — even if they don't know it.",
      match: ['ability', 'abilities'],
    },
    fr: {
      title: 'Capacité',
      def: "Le pouvoir spécial (ou la contrainte) d'un personnage, tel qu'écrit sur son rôle. Un joueur n'a plus de capacité s'il est mort, ivre ou empoisonné — même s'il ne le sait pas.",
      match: ['capacité', 'capacités'],
    },
  },
  {
    id: 'dead',
    en: {
      title: 'Dead',
      def: 'A player who is not alive. Dead players immediately lose their ability, cannot nominate, and may vote only once more for the rest of the game. They can still talk, can still be nominated, and still win or lose with their team. Their character is never revealed.',
      match: ['dead', 'died'],
    },
    fr: {
      title: 'Mort',
      def: "Un joueur qui n'est plus en vie. Un joueur mort perd immédiatement sa capacité, ne peut plus nominer et ne peut plus voter qu'une seule fois jusqu'à la fin de la partie. Il peut encore parler, peut encore être nominé, et gagne ou perd avec son camp. Son personnage n'est jamais révélé.",
      match: ['mort', 'morte', 'morts', 'mort(e)'],
    },
  },
  {
    id: 'neighbours',
    en: {
      title: 'Alive neighbours',
      def: 'The two alive players sitting closest to you — one on each side — skipping over any dead players in between.',
      match: ['alive neighbours', 'alive neighbors', 'neighbours', 'neighbors'],
    },
    fr: {
      title: 'Voisins en vie',
      def: 'Les deux joueurs en vie assis le plus près de vous — un de chaque côté — en sautant les joueurs morts entre vous.',
      match: ['voisins en vie', 'voisins'],
    },
  },
  {
    id: 'poisoned',
    en: {
      title: 'Poisoned',
      def: 'A poisoned player has no ability but thinks they do, and the game acts as if they do. If their ability gives information, it may be false. They are never told they are poisoned. Poison ends as soon as the Poisoner dies.',
      match: ['poisoned', 'poison'],
    },
    fr: {
      title: 'Empoisonné',
      def: "Un joueur empoisonné n'a plus de capacité mais croit l'avoir, et le jeu fait comme s'il l'avait. Si sa capacité donne une information, elle peut être fausse. On ne lui dit jamais qu'il est empoisonné. Le poison cesse dès que l'Empoisonneur meurt.",
      match: ['empoisonné', 'empoisonnée', 'empoisonner'],
    },
  },
  {
    id: 'drunk',
    en: {
      title: 'Drunk',
      def: 'A drunk player has no ability but thinks they do, and the game acts as if they do. If their ability gives information, it may be false. The Drunk (an Outsider) is always drunk: they are shown a Townsfolk character and never learn the truth until the game ends.',
      match: ['drunk'],
    },
    fr: {
      title: 'Ivre',
      def: "Un joueur ivre n'a plus de capacité mais croit l'avoir, et le jeu fait comme s'il l'avait. Si sa capacité donne une information, elle peut être fausse. L'Ivrogne (un Marginal) est toujours ivre : on lui montre un rôle de Villageois et il n'apprend la vérité qu'à la fin de la partie.",
      match: ['ivre', 'ivrogne'],
    },
  },
  {
    id: 'nominate',
    en: {
      title: 'Nomination',
      def: 'Calling for a vote to execute a player. Only living players may nominate, once per day each. Each player may be nominated once per day — dead players and yourself included. Only one nomination runs at a time: the accusation, then the defense, then the vote.',
      match: ['nominate', 'nominates', 'nominated', 'nomination', 'nominator', 'nominee'],
    },
    fr: {
      title: 'Nomination',
      def: "Demander un vote pour exécuter un joueur. Seuls les joueurs en vie peuvent nominer, une fois par jour chacun. Chaque joueur peut être nominé une fois par jour — y compris les morts et vous-même. Une seule nomination à la fois : l'accusation, puis la défense, puis le vote.",
      match: ['nominer', 'nomme', 'nomine', 'nominé', 'nominée', 'nomination', 'a nominé'],
    },
  },
  {
    id: 'execution',
    en: {
      title: 'Execution',
      def: 'The group decision to kill a player during the day. At most one execution per day, and there may be none. When the day ends, the player on the block is executed. Executing a dead player still counts as the day\'s execution (they simply stay dead).',
      match: ['execute', 'executed', 'execution', 'executes'],
    },
    fr: {
      title: 'Exécution',
      def: "La décision collective de tuer un joueur pendant la journée. Au plus une exécution par jour, et il peut n'y en avoir aucune. À la fin de la journée, le joueur sur le billot est exécuté. Exécuter un joueur mort compte quand même comme l'exécution du jour (il reste simplement mort).",
      match: ['exécuter', 'exécuté', 'exécutée', 'exécuté(e)', 'exécution', 'exécutions'],
    },
  },
  {
    id: 'vote',
    en: {
      title: 'Vote',
      def: 'Saying yes to executing the nominee. Votes go around the circle one player at a time, ending with the nominee (who may vote for themselves). Living players may vote as often as they like each day; a dead player has one vote left for the rest of the game. A vote succeeds with votes equal to at least half the living players — dead players\' votes count too.',
      match: ['vote', 'votes', 'voting'],
    },
    fr: {
      title: 'Vote',
      def: "Dire oui à l'exécution du joueur nominé. Le vote fait le tour du cercle, un joueur à la fois, en terminant par le nominé (qui peut voter pour lui-même). Les joueurs en vie votent autant qu'ils veulent chaque jour ; un joueur mort n'a plus qu'un vote pour le reste de la partie. Un vote réussit avec au moins la moitié des joueurs en vie en votes — les votes des morts comptent aussi.",
      match: ['vote', 'votes', 'voter'],
    },
  },
  {
    id: 'ghostVote',
    en: {
      title: 'Last vote (dead players)',
      def: 'Once dead, a player may vote "yes" only one more time for the rest of the game. Voting "no" does not use it up. Once it is used, that player is skipped in every later vote.',
      match: ['final vote', 'last vote', 'vote left', 'one vote left'],
    },
    fr: {
      title: 'Dernier vote (joueurs morts)',
      def: "Une fois mort, un joueur ne peut plus voter « oui » qu'une seule fois jusqu'à la fin de la partie. Voter « non » ne l'utilise pas. Une fois utilisé, ce joueur est sauté à tous les votes suivants.",
      match: ['dernier vote', 'vote restant', 'reste un vote'],
    },
  },
  {
    id: 'block',
    en: {
      title: 'On the block (about to die)',
      def: 'The player who has enough votes to be executed (at least half the living players) and more votes than any other player nominated today. If a later nominee ties that count, nobody is on the block; to take it back, someone must get strictly more votes.',
      match: ['on the block', 'most votes'],
    },
    fr: {
      title: 'Sur le billot',
      def: "Le joueur qui a assez de votes pour être exécuté (au moins la moitié des joueurs en vie) et plus de votes que tout autre joueur nominé aujourd'hui. Si un nominé suivant égale ce nombre, personne n'est sur le billot ; pour le reprendre, il faut strictement plus de votes.",
      match: ['sur le billot', 'le plus de votes'],
    },
  },
  {
    id: 'register',
    en: {
      title: 'Register',
      def: 'A player who "registers as" a character, type or alignment counts as that for other players\' abilities — but it is only a disguise: they keep their real character and alignment, and win with their real team. Registering as a character does not give its ability.',
      match: ['register', 'registers', 'registering'],
    },
    fr: {
      title: 'Apparaître comme',
      def: "Un joueur qui « apparaît comme » un rôle, un type ou un alignement compte comme tel pour les capacités des autres joueurs — mais ce n'est qu'un déguisement : il garde son vrai rôle et son vrai alignement, et gagne avec son vrai camp. Apparaître comme un rôle ne donne pas sa capacité.",
      match: ['apparaître', 'apparaît'],
    },
  },
  {
    id: 'might',
    en: {
      title: 'Might',
      def: 'Something that "might" happen is decided each time by the game (the Storyteller\'s job): sometimes it does, sometimes it doesn\'t.',
      match: ['might'],
    },
    fr: {
      title: 'Pourrait',
      def: "Ce qui « pourrait » arriver est décidé à chaque fois par le jeu (le rôle du Conteur) : parfois oui, parfois non.",
      match: ['pourriez', 'pourrait'],
    },
  },
  {
    id: 'nightStar',
    en: {
      title: 'Each night*',
      def: 'Every night except the first one.',
      match: ['each night*'],
    },
    fr: {
      title: 'Chaque nuit*',
      def: 'Chaque nuit, sauf la première.',
      match: ['chaque nuit*'],
    },
  },
  {
    id: 'startKnowing',
    en: {
      title: 'Start knowing',
      def: 'You learn this once, on the first night, and never again.',
      match: ['start knowing'],
    },
    fr: {
      title: 'Lors de votre première nuit',
      def: 'Vous apprenez cette information une seule fois, lors de la première nuit, et plus jamais ensuite.',
      match: ['lors de votre première nuit'],
    },
  },
  {
    id: 'oncePerGame',
    en: {
      title: 'Once per game',
      def: 'An ability that can be used only once. Using it while drunk or poisoned still uses it up. If the player dies without using it, it is lost.',
      match: ['once per game'],
    },
    fr: {
      title: 'Une fois par partie',
      def: "Une capacité qui ne peut être utilisée qu'une seule fois. L'utiliser en étant ivre ou empoisonné la consomme quand même. Si le joueur meurt sans l'avoir utilisée, elle est perdue.",
      match: ['une fois par partie'],
    },
  },
  {
    id: 'inPlay',
    en: {
      title: 'In play',
      def: 'A character that exists in the current game — held by a player, alive or dead. A character that is "not in play" is on the list of roles but nobody has it this game.',
      match: ['in play'],
    },
    fr: {
      title: 'En jeu',
      def: "Un personnage qui existe dans la partie en cours — tenu par un joueur, vivant ou mort. Un personnage « pas en jeu » figure dans la liste des rôles mais personne ne l'a dans cette partie.",
      match: ['en jeu'],
    },
  },
  {
    id: 'bluff',
    en: {
      title: 'Bluff',
      def: 'Pretending to be a character you are not. Anyone may bluff — evil players usually do, and good players sometimes do too. With 7 or more players, the Demon is shown 3 good characters that are not in play, which are safe to bluff as.',
      match: ['bluff', 'bluffs', 'bluffing'],
    },
    fr: {
      title: 'Bluff',
      def: "Prétendre être un personnage que l'on n'est pas. Tout le monde peut bluffer — les joueurs maléfiques le font presque toujours, les bons parfois aussi. À partir de 7 joueurs, on montre au Démon 3 personnages bons qui ne sont pas en jeu, qu'il peut prétendre être sans risque.",
      match: ['bluff', 'bluffer', 'prétendre'],
    },
  },
  {
    id: 'master',
    en: {
      title: 'Master (Butler)',
      def: 'The player the Butler chose last night. The next day, the Butler\'s "yes" vote only counts if their Master also votes yes on the same nomination.',
      match: ['master'],
    },
    fr: {
      title: 'Maître (Majordome)',
      def: "Le joueur choisi par le Majordome la nuit précédente. Le lendemain, le « oui » du Majordome ne compte que si son maître vote aussi oui sur la même nomination.",
      match: ['maître'],
    },
  },
  {
    id: 'slayerShot',
    en: {
      title: 'Slayer shot',
      def: 'Once per game, during the day, any living player may publicly claim to be the Slayer and shoot a player. Only if the shooter truly is the Slayer (not drunk or poisoned) and the target is the Demon does the Demon die. Otherwise nothing happens — and everyone sees the exact same "nothing happens", so a miss proves nothing about who fired it.',
      match: ['slayer shot'],
    },
    fr: {
      title: 'Tir de la Pourfendeuse',
      def: "Une fois par partie, pendant la journée, n'importe quel joueur en vie peut prétendre publiquement être la Pourfendeuse et tirer sur un joueur. Le Démon ne meurt que si le tireur est vraiment la Pourfendeuse (ni ivre ni empoisonnée) et que la cible est le Démon. Sinon il ne se passe rien — et tout le monde voit exactement le même « il ne se passe rien », donc un tir raté ne prouve rien sur le tireur.",
      match: ['tir de la pourfendeuse'],
    },
  },
  {
    id: 'grimoire',
    en: {
      title: 'Grimoire',
      def: 'The Storyteller\'s secret record of the whole game: every player\'s true character, who is alive or dead, who is poisoned, and so on. Players cannot look at it — except the Spy.',
      match: ['grimoire'],
    },
    fr: {
      title: 'Grimoire',
      def: "Le registre secret du Conteur : le vrai rôle de chaque joueur, qui est vivant ou mort, qui est empoisonné, etc. Les joueurs ne peuvent pas le voir — sauf l'Espionne.",
      match: ['grimoire'],
    },
  },
  {
    id: 'accusation',
    en: {
      title: 'Accusation & defense',
      def: 'After a nomination, the nominator speaks first (the accusation), then the nominee answers (the defense), then the vote begins. Each speech starts once everyone is ready, and either speaker may end their own speech early.',
      match: ['accusation', 'defense', 'accuses'],
    },
    fr: {
      title: 'Accusation et défense',
      def: "Après une nomination, celui qui nomine parle d'abord (l'accusation), puis le nominé répond (la défense), puis le vote commence. Chaque discours commence quand tout le monde est prêt, et chacun peut terminer son propre discours plus tôt.",
      match: ['accusation', 'défense', 'accuse'],
    },
  },
];

const glossaryMatchers = {};

function glossaryMatcher(lang) {
  if (glossaryMatchers[lang]) return glossaryMatchers[lang];
  const byForm = new Map();
  for (const g of GLOSSARY) {
    for (const form of (g[lang] || g.en).match) byForm.set(form.toLowerCase(), g.id);
  }
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Longest forms first, so "alive neighbours" wins over "neighbours" and "last vote" over "vote".
  const alternatives = [...byForm.keys()].sort((a, b) => b.length - a.length).map(escape);
  // Whole words only: never inside another word ("bon" in "bonjour", "vote" in "devoted").
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${alternatives.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  return (glossaryMatchers[lang] = { re, byForm });
}

/**
 * Splits `text` into plain pieces and glossary terms: [{ text }, { text, id }, ...]. Only the first
 * occurrence of each term is marked, and `excludeId` is never marked (a definition shouldn't
 * link to itself). Joining every piece's text always gives back `text` exactly.
 */
// eslint-disable-next-line no-unused-vars
function glossarySegments(text, lang, excludeId) {
  const { re, byForm } = glossaryMatcher(GLOSSARY[0][lang] ? lang : 'en');
  const used = new Set(excludeId ? [excludeId] : []);
  const out = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const id = byForm.get(m[0].toLowerCase());
    if (!id || used.has(id)) continue;
    used.add(id);
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], id });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
