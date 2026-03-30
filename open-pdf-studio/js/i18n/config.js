import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// English translations
import enCommon from './locales/en/common.json';
import enRibbon from './locales/en/ribbon.json';
import enPreferences from './locales/en/preferences.json';
import enDialogs from './locales/en/dialogs.json';
import enAppMenu from './locales/en/appMenu.json';
import enProperties from './locales/en/properties.json';
import enContext from './locales/en/context.json';
import enStatusbar from './locales/en/statusbar.json';

// Dutch translations
import nlCommon from './locales/nl/common.json';
import nlRibbon from './locales/nl/ribbon.json';
import nlPreferences from './locales/nl/preferences.json';
import nlDialogs from './locales/nl/dialogs.json';
import nlAppMenu from './locales/nl/appMenu.json';
import nlProperties from './locales/nl/properties.json';
import nlContext from './locales/nl/context.json';
import nlStatusbar from './locales/nl/statusbar.json';

// French translations
import frCommon from './locales/fr/common.json';
import frRibbon from './locales/fr/ribbon.json';
import frPreferences from './locales/fr/preferences.json';
import frDialogs from './locales/fr/dialogs.json';
import frAppMenu from './locales/fr/appMenu.json';
import frProperties from './locales/fr/properties.json';
import frContext from './locales/fr/context.json';
import frStatusbar from './locales/fr/statusbar.json';

// German translations
import deCommon from './locales/de/common.json';
import deRibbon from './locales/de/ribbon.json';
import dePreferences from './locales/de/preferences.json';
import deDialogs from './locales/de/dialogs.json';
import deAppMenu from './locales/de/appMenu.json';
import deProperties from './locales/de/properties.json';
import deContext from './locales/de/context.json';
import deStatusbar from './locales/de/statusbar.json';

// Spanish translations
import esCommon from './locales/es/common.json';
import esRibbon from './locales/es/ribbon.json';
import esPreferences from './locales/es/preferences.json';
import esDialogs from './locales/es/dialogs.json';
import esAppMenu from './locales/es/appMenu.json';
import esProperties from './locales/es/properties.json';
import esContext from './locales/es/context.json';
import esStatusbar from './locales/es/statusbar.json';

// Chinese translations
import zhCommon from './locales/zh/common.json';
import zhRibbon from './locales/zh/ribbon.json';
import zhPreferences from './locales/zh/preferences.json';
import zhDialogs from './locales/zh/dialogs.json';
import zhAppMenu from './locales/zh/appMenu.json';
import zhProperties from './locales/zh/properties.json';
import zhContext from './locales/zh/context.json';
import zhStatusbar from './locales/zh/statusbar.json';

// Italian translations
import itCommon from './locales/it/common.json';
import itRibbon from './locales/it/ribbon.json';
import itPreferences from './locales/it/preferences.json';
import itDialogs from './locales/it/dialogs.json';
import itAppMenu from './locales/it/appMenu.json';
import itProperties from './locales/it/properties.json';
import itContext from './locales/it/context.json';
import itStatusbar from './locales/it/statusbar.json';

// Portuguese translations
import ptCommon from './locales/pt/common.json';
import ptRibbon from './locales/pt/ribbon.json';
import ptPreferences from './locales/pt/preferences.json';
import ptDialogs from './locales/pt/dialogs.json';
import ptAppMenu from './locales/pt/appMenu.json';
import ptProperties from './locales/pt/properties.json';
import ptContext from './locales/pt/context.json';
import ptStatusbar from './locales/pt/statusbar.json';

// Polish translations
import plCommon from './locales/pl/common.json';
import plRibbon from './locales/pl/ribbon.json';
import plPreferences from './locales/pl/preferences.json';
import plDialogs from './locales/pl/dialogs.json';
import plAppMenu from './locales/pl/appMenu.json';
import plProperties from './locales/pl/properties.json';
import plContext from './locales/pl/context.json';
import plStatusbar from './locales/pl/statusbar.json';

// Turkish translations
import trCommon from './locales/tr/common.json';
import trRibbon from './locales/tr/ribbon.json';
import trPreferences from './locales/tr/preferences.json';
import trDialogs from './locales/tr/dialogs.json';
import trAppMenu from './locales/tr/appMenu.json';
import trProperties from './locales/tr/properties.json';
import trContext from './locales/tr/context.json';
import trStatusbar from './locales/tr/statusbar.json';

// Arabic translations
import arCommon from './locales/ar/common.json';
import arRibbon from './locales/ar/ribbon.json';
import arPreferences from './locales/ar/preferences.json';
import arDialogs from './locales/ar/dialogs.json';
import arAppMenu from './locales/ar/appMenu.json';
import arProperties from './locales/ar/properties.json';
import arContext from './locales/ar/context.json';
import arStatusbar from './locales/ar/statusbar.json';

// Japanese translations
import jaCommon from './locales/ja/common.json';
import jaRibbon from './locales/ja/ribbon.json';
import jaPreferences from './locales/ja/preferences.json';
import jaDialogs from './locales/ja/dialogs.json';
import jaAppMenu from './locales/ja/appMenu.json';
import jaProperties from './locales/ja/properties.json';
import jaContext from './locales/ja/context.json';
import jaStatusbar from './locales/ja/statusbar.json';

// Korean translations
import koCommon from './locales/ko/common.json';
import koRibbon from './locales/ko/ribbon.json';
import koPreferences from './locales/ko/preferences.json';
import koDialogs from './locales/ko/dialogs.json';
import koAppMenu from './locales/ko/appMenu.json';
import koProperties from './locales/ko/properties.json';
import koContext from './locales/ko/context.json';
import koStatusbar from './locales/ko/statusbar.json';

// Farsi translations
import faCommon from './locales/fa/common.json';
import faRibbon from './locales/fa/ribbon.json';
import faPreferences from './locales/fa/preferences.json';
import faDialogs from './locales/fa/dialogs.json';
import faAppMenu from './locales/fa/appMenu.json';
import faProperties from './locales/fa/properties.json';
import faContext from './locales/fa/context.json';
import faStatusbar from './locales/fa/statusbar.json';

// Bengali translations
import bnCommon from './locales/bn/common.json';
import bnRibbon from './locales/bn/ribbon.json';
import bnPreferences from './locales/bn/preferences.json';
import bnDialogs from './locales/bn/dialogs.json';
import bnAppMenu from './locales/bn/appMenu.json';
import bnProperties from './locales/bn/properties.json';
import bnContext from './locales/bn/context.json';
import bnStatusbar from './locales/bn/statusbar.json';

// Bulgarian translations
import bgCommon from './locales/bg/common.json';
import bgRibbon from './locales/bg/ribbon.json';
import bgPreferences from './locales/bg/preferences.json';
import bgDialogs from './locales/bg/dialogs.json';
import bgAppMenu from './locales/bg/appMenu.json';
import bgProperties from './locales/bg/properties.json';
import bgContext from './locales/bg/context.json';
import bgStatusbar from './locales/bg/statusbar.json';

// Catalan translations
import caCommon from './locales/ca/common.json';
import caRibbon from './locales/ca/ribbon.json';
import caPreferences from './locales/ca/preferences.json';
import caDialogs from './locales/ca/dialogs.json';
import caAppMenu from './locales/ca/appMenu.json';
import caProperties from './locales/ca/properties.json';
import caContext from './locales/ca/context.json';
import caStatusbar from './locales/ca/statusbar.json';

// Croatian translations
import hrCommon from './locales/hr/common.json';
import hrRibbon from './locales/hr/ribbon.json';
import hrPreferences from './locales/hr/preferences.json';
import hrDialogs from './locales/hr/dialogs.json';
import hrAppMenu from './locales/hr/appMenu.json';
import hrProperties from './locales/hr/properties.json';
import hrContext from './locales/hr/context.json';
import hrStatusbar from './locales/hr/statusbar.json';

// Czech translations
import csCommon from './locales/cs/common.json';
import csRibbon from './locales/cs/ribbon.json';
import csPreferences from './locales/cs/preferences.json';
import csDialogs from './locales/cs/dialogs.json';
import csAppMenu from './locales/cs/appMenu.json';
import csProperties from './locales/cs/properties.json';
import csContext from './locales/cs/context.json';
import csStatusbar from './locales/cs/statusbar.json';

// Danish translations
import daCommon from './locales/da/common.json';
import daRibbon from './locales/da/ribbon.json';
import daPreferences from './locales/da/preferences.json';
import daDialogs from './locales/da/dialogs.json';
import daAppMenu from './locales/da/appMenu.json';
import daProperties from './locales/da/properties.json';
import daContext from './locales/da/context.json';
import daStatusbar from './locales/da/statusbar.json';

// Finnish translations
import fiCommon from './locales/fi/common.json';
import fiRibbon from './locales/fi/ribbon.json';
import fiPreferences from './locales/fi/preferences.json';
import fiDialogs from './locales/fi/dialogs.json';
import fiAppMenu from './locales/fi/appMenu.json';
import fiProperties from './locales/fi/properties.json';
import fiContext from './locales/fi/context.json';
import fiStatusbar from './locales/fi/statusbar.json';

// Greek translations
import elCommon from './locales/el/common.json';
import elRibbon from './locales/el/ribbon.json';
import elPreferences from './locales/el/preferences.json';
import elDialogs from './locales/el/dialogs.json';
import elAppMenu from './locales/el/appMenu.json';
import elProperties from './locales/el/properties.json';
import elContext from './locales/el/context.json';
import elStatusbar from './locales/el/statusbar.json';

// Hebrew translations
import heCommon from './locales/he/common.json';
import heRibbon from './locales/he/ribbon.json';
import hePreferences from './locales/he/preferences.json';
import heDialogs from './locales/he/dialogs.json';
import heAppMenu from './locales/he/appMenu.json';
import heProperties from './locales/he/properties.json';
import heContext from './locales/he/context.json';
import heStatusbar from './locales/he/statusbar.json';

// Hindi translations
import hiCommon from './locales/hi/common.json';
import hiRibbon from './locales/hi/ribbon.json';
import hiPreferences from './locales/hi/preferences.json';
import hiDialogs from './locales/hi/dialogs.json';
import hiAppMenu from './locales/hi/appMenu.json';
import hiProperties from './locales/hi/properties.json';
import hiContext from './locales/hi/context.json';
import hiStatusbar from './locales/hi/statusbar.json';

// Hungarian translations
import huCommon from './locales/hu/common.json';
import huRibbon from './locales/hu/ribbon.json';
import huPreferences from './locales/hu/preferences.json';
import huDialogs from './locales/hu/dialogs.json';
import huAppMenu from './locales/hu/appMenu.json';
import huProperties from './locales/hu/properties.json';
import huContext from './locales/hu/context.json';
import huStatusbar from './locales/hu/statusbar.json';

// Indonesian translations
import idCommon from './locales/id/common.json';
import idRibbon from './locales/id/ribbon.json';
import idPreferences from './locales/id/preferences.json';
import idDialogs from './locales/id/dialogs.json';
import idAppMenu from './locales/id/appMenu.json';
import idProperties from './locales/id/properties.json';
import idContext from './locales/id/context.json';
import idStatusbar from './locales/id/statusbar.json';

// Malay translations
import msCommon from './locales/ms/common.json';
import msRibbon from './locales/ms/ribbon.json';
import msPreferences from './locales/ms/preferences.json';
import msDialogs from './locales/ms/dialogs.json';
import msAppMenu from './locales/ms/appMenu.json';
import msProperties from './locales/ms/properties.json';
import msContext from './locales/ms/context.json';
import msStatusbar from './locales/ms/statusbar.json';

// Norwegian translations
import nbCommon from './locales/nb/common.json';
import nbRibbon from './locales/nb/ribbon.json';
import nbPreferences from './locales/nb/preferences.json';
import nbDialogs from './locales/nb/dialogs.json';
import nbAppMenu from './locales/nb/appMenu.json';
import nbProperties from './locales/nb/properties.json';
import nbContext from './locales/nb/context.json';
import nbStatusbar from './locales/nb/statusbar.json';

// Romanian translations
import roCommon from './locales/ro/common.json';
import roRibbon from './locales/ro/ribbon.json';
import roPreferences from './locales/ro/preferences.json';
import roDialogs from './locales/ro/dialogs.json';
import roAppMenu from './locales/ro/appMenu.json';
import roProperties from './locales/ro/properties.json';
import roContext from './locales/ro/context.json';
import roStatusbar from './locales/ro/statusbar.json';

// Russian translations
import ruCommon from './locales/ru/common.json';
import ruRibbon from './locales/ru/ribbon.json';
import ruPreferences from './locales/ru/preferences.json';
import ruDialogs from './locales/ru/dialogs.json';
import ruAppMenu from './locales/ru/appMenu.json';
import ruProperties from './locales/ru/properties.json';
import ruContext from './locales/ru/context.json';
import ruStatusbar from './locales/ru/statusbar.json';

// Serbian translations
import srCommon from './locales/sr/common.json';
import srRibbon from './locales/sr/ribbon.json';
import srPreferences from './locales/sr/preferences.json';
import srDialogs from './locales/sr/dialogs.json';
import srAppMenu from './locales/sr/appMenu.json';
import srProperties from './locales/sr/properties.json';
import srContext from './locales/sr/context.json';
import srStatusbar from './locales/sr/statusbar.json';

// Slovak translations
import skCommon from './locales/sk/common.json';
import skRibbon from './locales/sk/ribbon.json';
import skPreferences from './locales/sk/preferences.json';
import skDialogs from './locales/sk/dialogs.json';
import skAppMenu from './locales/sk/appMenu.json';
import skProperties from './locales/sk/properties.json';
import skContext from './locales/sk/context.json';
import skStatusbar from './locales/sk/statusbar.json';

// Swedish translations
import svCommon from './locales/sv/common.json';
import svRibbon from './locales/sv/ribbon.json';
import svPreferences from './locales/sv/preferences.json';
import svDialogs from './locales/sv/dialogs.json';
import svAppMenu from './locales/sv/appMenu.json';
import svProperties from './locales/sv/properties.json';
import svContext from './locales/sv/context.json';
import svStatusbar from './locales/sv/statusbar.json';

// Swahili translations
import swCommon from './locales/sw/common.json';
import swRibbon from './locales/sw/ribbon.json';
import swPreferences from './locales/sw/preferences.json';
import swDialogs from './locales/sw/dialogs.json';
import swAppMenu from './locales/sw/appMenu.json';
import swProperties from './locales/sw/properties.json';
import swContext from './locales/sw/context.json';
import swStatusbar from './locales/sw/statusbar.json';

// Tamil translations
import taCommon from './locales/ta/common.json';
import taRibbon from './locales/ta/ribbon.json';
import taPreferences from './locales/ta/preferences.json';
import taDialogs from './locales/ta/dialogs.json';
import taAppMenu from './locales/ta/appMenu.json';
import taProperties from './locales/ta/properties.json';
import taContext from './locales/ta/context.json';
import taStatusbar from './locales/ta/statusbar.json';

// Thai translations
import thCommon from './locales/th/common.json';
import thRibbon from './locales/th/ribbon.json';
import thPreferences from './locales/th/preferences.json';
import thDialogs from './locales/th/dialogs.json';
import thAppMenu from './locales/th/appMenu.json';
import thProperties from './locales/th/properties.json';
import thContext from './locales/th/context.json';
import thStatusbar from './locales/th/statusbar.json';

// Ukrainian translations
import ukCommon from './locales/uk/common.json';
import ukRibbon from './locales/uk/ribbon.json';
import ukPreferences from './locales/uk/preferences.json';
import ukDialogs from './locales/uk/dialogs.json';
import ukAppMenu from './locales/uk/appMenu.json';
import ukProperties from './locales/uk/properties.json';
import ukContext from './locales/uk/context.json';
import ukStatusbar from './locales/uk/statusbar.json';

// Urdu translations
import urCommon from './locales/ur/common.json';
import urRibbon from './locales/ur/ribbon.json';
import urPreferences from './locales/ur/preferences.json';
import urDialogs from './locales/ur/dialogs.json';
import urAppMenu from './locales/ur/appMenu.json';
import urProperties from './locales/ur/properties.json';
import urContext from './locales/ur/context.json';
import urStatusbar from './locales/ur/statusbar.json';

// Vietnamese translations
import viCommon from './locales/vi/common.json';
import viRibbon from './locales/vi/ribbon.json';
import viPreferences from './locales/vi/preferences.json';
import viDialogs from './locales/vi/dialogs.json';
import viAppMenu from './locales/vi/appMenu.json';
import viProperties from './locales/vi/properties.json';
import viContext from './locales/vi/context.json';
import viStatusbar from './locales/vi/statusbar.json';

const ns = ['common', 'ribbon', 'preferences', 'dialogs', 'appMenu', 'properties', 'context', 'statusbar'];

export const LANGUAGES = [
  { code: 'auto', name: 'Auto-detect', englishName: 'Auto-detect' },
  { code: 'ar', name: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629', englishName: 'Arabic', dir: 'rtl' },
  { code: 'bn', name: '\u09ac\u09be\u0982\u09b2\u09be', englishName: 'Bengali' },
  { code: 'bg', name: '\u0411\u044a\u043b\u0433\u0430\u0440\u0441\u043a\u0438', englishName: 'Bulgarian' },
  { code: 'ca', name: 'Catal\u00e0', englishName: 'Catalan' },
  { code: 'zh', name: '\u4e2d\u6587', englishName: 'Chinese' },
  { code: 'hr', name: 'Hrvatski', englishName: 'Croatian' },
  { code: 'cs', name: '\u010ce\u0161tina', englishName: 'Czech' },
  { code: 'da', name: 'Dansk', englishName: 'Danish' },
  { code: 'nl', name: 'Nederlands', englishName: 'Dutch' },
  { code: 'en', name: 'English', englishName: 'English' },
  { code: 'fa', name: '\u0641\u0627\u0631\u0633\u06cc', englishName: 'Farsi', dir: 'rtl' },
  { code: 'fi', name: 'Suomi', englishName: 'Finnish' },
  { code: 'fr', name: 'Fran\u00e7ais', englishName: 'French' },
  { code: 'de', name: 'Deutsch', englishName: 'German' },
  { code: 'el', name: '\u0395\u03bb\u03bb\u03b7\u03bd\u03b9\u03ba\u03ac', englishName: 'Greek' },
  { code: 'he', name: '\u05e2\u05d1\u05e8\u05d9\u05ea', englishName: 'Hebrew', dir: 'rtl' },
  { code: 'hi', name: '\u0939\u093f\u0928\u094d\u0926\u0940', englishName: 'Hindi' },
  { code: 'hu', name: 'Magyar', englishName: 'Hungarian' },
  { code: 'id', name: 'Bahasa Indonesia', englishName: 'Indonesian' },
  { code: 'it', name: 'Italiano', englishName: 'Italian' },
  { code: 'ja', name: '\u65e5\u672c\u8a9e', englishName: 'Japanese' },
  { code: 'ko', name: '\ud55c\uad6d\uc5b4', englishName: 'Korean' },
  { code: 'ms', name: 'Bahasa Melayu', englishName: 'Malay' },
  { code: 'nb', name: 'Norsk', englishName: 'Norwegian' },
  { code: 'pl', name: 'Polski', englishName: 'Polish' },
  { code: 'pt', name: 'Portugu\u00eas', englishName: 'Portuguese' },
  { code: 'ro', name: 'Rom\u00e2n\u0103', englishName: 'Romanian' },
  { code: 'ru', name: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439', englishName: 'Russian' },
  { code: 'sr', name: '\u0421\u0440\u043f\u0441\u043a\u0438', englishName: 'Serbian' },
  { code: 'sk', name: 'Sloven\u010dina', englishName: 'Slovak' },
  { code: 'es', name: 'Espa\u00f1ol', englishName: 'Spanish' },
  { code: 'sw', name: 'Kiswahili', englishName: 'Swahili' },
  { code: 'sv', name: 'Svenska', englishName: 'Swedish' },
  { code: 'ta', name: '\u0ba4\u0bae\u0bbf\u0bb4\u0bcd', englishName: 'Tamil' },
  { code: 'th', name: '\u0e44\u0e17\u0e22', englishName: 'Thai' },
  { code: 'tr', name: 'T\u00fcrk\u00e7e', englishName: 'Turkish' },
  { code: 'uk', name: '\u0423\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0430', englishName: 'Ukrainian' },
  { code: 'ur', name: '\u0627\u0631\u062f\u0648', englishName: 'Urdu', dir: 'rtl' },
  { code: 'vi', name: 'Ti\u1ebfng Vi\u1ec7t', englishName: 'Vietnamese' },
];

export const RTL_LANGUAGES = ['ar', 'fa', 'he', 'ur'];

export function isRTL(lang) {
  return RTL_LANGUAGES.includes(lang);
}

i18next
  .use(LanguageDetector)
  .init({
    resources: {
      en: { common: enCommon, ribbon: enRibbon, preferences: enPreferences, dialogs: enDialogs, appMenu: enAppMenu, properties: enProperties, context: enContext, statusbar: enStatusbar },
      nl: { common: nlCommon, ribbon: nlRibbon, preferences: nlPreferences, dialogs: nlDialogs, appMenu: nlAppMenu, properties: nlProperties, context: nlContext, statusbar: nlStatusbar },
      fr: { common: frCommon, ribbon: frRibbon, preferences: frPreferences, dialogs: frDialogs, appMenu: frAppMenu, properties: frProperties, context: frContext, statusbar: frStatusbar },
      de: { common: deCommon, ribbon: deRibbon, preferences: dePreferences, dialogs: deDialogs, appMenu: deAppMenu, properties: deProperties, context: deContext, statusbar: deStatusbar },
      es: { common: esCommon, ribbon: esRibbon, preferences: esPreferences, dialogs: esDialogs, appMenu: esAppMenu, properties: esProperties, context: esContext, statusbar: esStatusbar },
      zh: { common: zhCommon, ribbon: zhRibbon, preferences: zhPreferences, dialogs: zhDialogs, appMenu: zhAppMenu, properties: zhProperties, context: zhContext, statusbar: zhStatusbar },
      it: { common: itCommon, ribbon: itRibbon, preferences: itPreferences, dialogs: itDialogs, appMenu: itAppMenu, properties: itProperties, context: itContext, statusbar: itStatusbar },
      pt: { common: ptCommon, ribbon: ptRibbon, preferences: ptPreferences, dialogs: ptDialogs, appMenu: ptAppMenu, properties: ptProperties, context: ptContext, statusbar: ptStatusbar },
      pl: { common: plCommon, ribbon: plRibbon, preferences: plPreferences, dialogs: plDialogs, appMenu: plAppMenu, properties: plProperties, context: plContext, statusbar: plStatusbar },
      tr: { common: trCommon, ribbon: trRibbon, preferences: trPreferences, dialogs: trDialogs, appMenu: trAppMenu, properties: trProperties, context: trContext, statusbar: trStatusbar },
      ar: { common: arCommon, ribbon: arRibbon, preferences: arPreferences, dialogs: arDialogs, appMenu: arAppMenu, properties: arProperties, context: arContext, statusbar: arStatusbar },
      ja: { common: jaCommon, ribbon: jaRibbon, preferences: jaPreferences, dialogs: jaDialogs, appMenu: jaAppMenu, properties: jaProperties, context: jaContext, statusbar: jaStatusbar },
      ko: { common: koCommon, ribbon: koRibbon, preferences: koPreferences, dialogs: koDialogs, appMenu: koAppMenu, properties: koProperties, context: koContext, statusbar: koStatusbar },
      fa: { common: faCommon, ribbon: faRibbon, preferences: faPreferences, dialogs: faDialogs, appMenu: faAppMenu, properties: faProperties, context: faContext, statusbar: faStatusbar },
      bn: { common: bnCommon, ribbon: bnRibbon, preferences: bnPreferences, dialogs: bnDialogs, appMenu: bnAppMenu, properties: bnProperties, context: bnContext, statusbar: bnStatusbar },
      bg: { common: bgCommon, ribbon: bgRibbon, preferences: bgPreferences, dialogs: bgDialogs, appMenu: bgAppMenu, properties: bgProperties, context: bgContext, statusbar: bgStatusbar },
      ca: { common: caCommon, ribbon: caRibbon, preferences: caPreferences, dialogs: caDialogs, appMenu: caAppMenu, properties: caProperties, context: caContext, statusbar: caStatusbar },
      hr: { common: hrCommon, ribbon: hrRibbon, preferences: hrPreferences, dialogs: hrDialogs, appMenu: hrAppMenu, properties: hrProperties, context: hrContext, statusbar: hrStatusbar },
      cs: { common: csCommon, ribbon: csRibbon, preferences: csPreferences, dialogs: csDialogs, appMenu: csAppMenu, properties: csProperties, context: csContext, statusbar: csStatusbar },
      da: { common: daCommon, ribbon: daRibbon, preferences: daPreferences, dialogs: daDialogs, appMenu: daAppMenu, properties: daProperties, context: daContext, statusbar: daStatusbar },
      fi: { common: fiCommon, ribbon: fiRibbon, preferences: fiPreferences, dialogs: fiDialogs, appMenu: fiAppMenu, properties: fiProperties, context: fiContext, statusbar: fiStatusbar },
      el: { common: elCommon, ribbon: elRibbon, preferences: elPreferences, dialogs: elDialogs, appMenu: elAppMenu, properties: elProperties, context: elContext, statusbar: elStatusbar },
      he: { common: heCommon, ribbon: heRibbon, preferences: hePreferences, dialogs: heDialogs, appMenu: heAppMenu, properties: heProperties, context: heContext, statusbar: heStatusbar },
      hi: { common: hiCommon, ribbon: hiRibbon, preferences: hiPreferences, dialogs: hiDialogs, appMenu: hiAppMenu, properties: hiProperties, context: hiContext, statusbar: hiStatusbar },
      hu: { common: huCommon, ribbon: huRibbon, preferences: huPreferences, dialogs: huDialogs, appMenu: huAppMenu, properties: huProperties, context: huContext, statusbar: huStatusbar },
      id: { common: idCommon, ribbon: idRibbon, preferences: idPreferences, dialogs: idDialogs, appMenu: idAppMenu, properties: idProperties, context: idContext, statusbar: idStatusbar },
      ms: { common: msCommon, ribbon: msRibbon, preferences: msPreferences, dialogs: msDialogs, appMenu: msAppMenu, properties: msProperties, context: msContext, statusbar: msStatusbar },
      nb: { common: nbCommon, ribbon: nbRibbon, preferences: nbPreferences, dialogs: nbDialogs, appMenu: nbAppMenu, properties: nbProperties, context: nbContext, statusbar: nbStatusbar },
      ro: { common: roCommon, ribbon: roRibbon, preferences: roPreferences, dialogs: roDialogs, appMenu: roAppMenu, properties: roProperties, context: roContext, statusbar: roStatusbar },
      ru: { common: ruCommon, ribbon: ruRibbon, preferences: ruPreferences, dialogs: ruDialogs, appMenu: ruAppMenu, properties: ruProperties, context: ruContext, statusbar: ruStatusbar },
      sr: { common: srCommon, ribbon: srRibbon, preferences: srPreferences, dialogs: srDialogs, appMenu: srAppMenu, properties: srProperties, context: srContext, statusbar: srStatusbar },
      sk: { common: skCommon, ribbon: skRibbon, preferences: skPreferences, dialogs: skDialogs, appMenu: skAppMenu, properties: skProperties, context: skContext, statusbar: skStatusbar },
      sv: { common: svCommon, ribbon: svRibbon, preferences: svPreferences, dialogs: svDialogs, appMenu: svAppMenu, properties: svProperties, context: svContext, statusbar: svStatusbar },
      sw: { common: swCommon, ribbon: swRibbon, preferences: swPreferences, dialogs: swDialogs, appMenu: swAppMenu, properties: swProperties, context: swContext, statusbar: swStatusbar },
      ta: { common: taCommon, ribbon: taRibbon, preferences: taPreferences, dialogs: taDialogs, appMenu: taAppMenu, properties: taProperties, context: taContext, statusbar: taStatusbar },
      th: { common: thCommon, ribbon: thRibbon, preferences: thPreferences, dialogs: thDialogs, appMenu: thAppMenu, properties: thProperties, context: thContext, statusbar: thStatusbar },
      uk: { common: ukCommon, ribbon: ukRibbon, preferences: ukPreferences, dialogs: ukDialogs, appMenu: ukAppMenu, properties: ukProperties, context: ukContext, statusbar: ukStatusbar },
      ur: { common: urCommon, ribbon: urRibbon, preferences: urPreferences, dialogs: urDialogs, appMenu: urAppMenu, properties: urProperties, context: urContext, statusbar: urStatusbar },
      vi: { common: viCommon, ribbon: viRibbon, preferences: viPreferences, dialogs: viDialogs, appMenu: viAppMenu, properties: viProperties, context: viContext, statusbar: viStatusbar }
    },
    ns,
    defaultNS: 'common',
    fallbackLng: 'en',
    showSupportNotice: false,
    interpolation: {
      escapeValue: false
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'i18nextLng',
      caches: []
    }
  });

export default i18next;
