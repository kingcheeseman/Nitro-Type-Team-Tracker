// Maps a Nitro Type car's numeric id (the "carID" field on each member in
// the team API - see ingest.js's upsertRacer) to the filename slug Nitro
// Type's own CDN uses for that car's thumbnail image.
//
// Nitro Type's team page (nitrotype.com/team/<tag>) renders each racer's
// current car as <img src="https://www.nitrotype.com/cars/<slug>_small.png">
// (or ".../cars/painted/<slug>_small_<hueAngle>.png" for a repainted car -
// see carImageUrl in theme.js), but the team API we already sync from only
// gives the numeric carID, not this slug. There's no public API that maps
// one to the other, so this table was built by cross-referencing Nitro
// Type's own CDN (confirmed directly against a live team page - carID 344
// is "ghost_catcher") with nitrotype.info's Cars archive, which states it
// mirrors "the archive's current Nitro Type dataset" and uses the same
// slug/suffix naming convention.
//
// This is best-effort, not authoritative: a new car added after this table
// was captured won't resolve, and a small number of entries may be stale
// or wrong. theme.js's car image renders with onerror="this.remove()" for
// exactly this reason - a bad/missing slug just quietly omits the car
// picture instead of showing a broken-image icon, so a wrong or outdated
// entry here never breaks the page.
const CAR_SLUGS = {
  2: "mephisto", 4: "picante", 5: "bantlyss", 6: "therolls", 7: "winstoncitroen",
  8: "winstonagile", 10: "missionaccomplished", 13: "auttieb9", 16: "misouxtoad",
  18: "nizza350", 19: "oneace", 20: "cougarace", 23: "bensv20", 25: "portchspyder",
  26: "auttieroadster", 27: "bimmer20", 28: "bimmer9", 40: "shellbackrt500",
  43: "suprillia", 45: "stallion", 47: "fastback", 52: "pizza", 54: "atv2",
  55: "mp427", 58: "f35", 62: "bighauler", 64: "gt40", 69: "rocketsleigh",
  79: "ezrider", 84: "hang11", 93: "fluxm300", 96: "auttier8", 110: "hammerwheels",
  128: "yacht", 135: "corsa_xmaxx", 138: "strykist", 177: "blitz_cobalt1",
  180: "brightidea", 188: "taterpowered", 197: "rocketklaus", 198: "police_cruiser",
  201: "nye", 207: "grid", 227: "jet_powered_truck", 228: "vengeance", 230: "x2",
  232: "monster_redux", 233: "covenant", 234: "zonday2021", 235: "gatorayd",
  236: "flamerod", 237: "linuxelipse", 238: "roadwarriorrally", 239: "badrax",
  241: "n6sport", 245: "thekelvin", 246: "vyzuadk226", 247: "error503",
  249: "sprinter", 250: "rally", 251: "msg01", 252: "djcruzer", 253: "gtr1",
  254: "gtr50", 255: "technotruck", 256: "fourleafrover", 257: "lambouhuh",
  258: "sprintervapor", 259: "amphibbtly", 260: "corsamystica", 261: "h2ocar",
  265: "neon", 266: "mongoose", 267: "corsamegalodor123", 268: "locomotive",
  269: "jatv1", 270: "jet_boat", 271: "dunebounder", 272: "corsapunti",
  273: "lifeguard", 274: "libertyog", 276: "fluxmemo", 277: "fully_leaded",
  278: "kce", 279: "rulebreaker", 280: "jet_bus", 281: "scream", 282: "ghoul_bus",
  283: "blitz_935", 284: "shopping_cart", 285: "haytruck", 286: "tractor",
  287: "libertys7a", 288: "tbutler56a", 289: "abutleer12", 290: "acrook53",
  291: "ksmith", 292: "hbonacci8", 293: "kosburn21", 294: "minifiretruck",
  295: "gtank", 297: "elfmobile", 298: "candido", 299: "party_sleigh",
  300: "lit_train", 301: "snowcat", 302: "racing_led", 303: "nadaracer",
  304: "panoz", 305: "heartbox", 306: "candycar", 310: "supercarrier",
  311: "radon620c", 312: "manta", 313: "flowerpower", 314: "ice_cream_clown",
  315: "coldsnap", 316: "demon", 317: "tempest", 318: "robo",
  320: "drone_chariot", 322: "time_machine", 323: "ship_of_line",
  324: "pagani", 325: "hawkins", 331: "f1bug", 333: "ytdriver",
  336: "shadowmaxx", 338: "blizferr", 339: "lambov12", 340: "nitreux123",
  341: "light_bike", 342: "millionare_special", 343: "blackbird",
  344: "ghost_catcher", 346: "darkstar", 347: "discord", 349: "cerberus",
  350: "anaconda", 354: "birdy", 355: "amg", 356: "thex", 361: "tumbler",
  362: "xmaxxhyper", 368: "choppa", 370: "roadster", 371: "ultima",
  372: "wflower", 373: "industrial", 374: "armored", 375: "ytcamaro",
  376: "santasport", 379: "dragon", 381: "blossom", 382: "boxcar",
  387: "scarecrow", 388: "dragracetruck", 391: "xmaxxmobile", 392: "snowgrave",
  413: "nitreuxcryonfx", 414: "bobsled", 415: "snowplow", 420: "skadivii",
  421: "creepersi2", 422: "16bitracerr", 423: "runeracerrrrr",
  424: "corsapepperoni", 425: "polygon", 426: "arcade", 427: "asteroncartoncar2",
  428: "meowwww", 429: "sharkgon", 430: "dolphin", 431: "fonnicciaero",
  432: "stingquant", 433: "luminine2wfdwe", 434: "blimpp", 435: "hydroaaaa",
  436: "glass", 437: "vistaflyer", 438: "hurricania", 439: "apollof",
  440: "corsaimmortx", 442: "zeusasdfgh", 443: "icarus", 444: "underworld",
  445: "cactus", 446: "roughrider", 449: "pinkerton", 451: "fuji",
  452: "neo_digital", 453: "bloomx1", 454: "stickerbomb1", 455: "gtsprismav1",
  456: "kurov1", 457: "nightmarez1", 458: "inkspecsi1", 459: "hanamitype1v2",
  479: "spirit_racers_final_seal", 480: "spirit_koi",
  481: "spirit_racers_paper_crane2", 482: "spirit_racers_ink_fox",
  483: "spirit_racers_night_moth", 484: "shadow_dragon",
};

module.exports = { CAR_SLUGS };
