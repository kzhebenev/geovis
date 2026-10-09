import type { Lang } from './settings'

const DICT = {
  ru: {
    title: 'Плотность населения Земли', projection: 'Проекция', globe: 'Глобус', map: 'Карта',
    detail: 'Детализация', scale: 'Шкала высоты', log: 'Лог', sqrt: 'Корень', linear: 'Линейная',
    height: 'Высота', palette: 'Палитра', labels: 'Подписи', cities: 'Города', countries: 'Страны',
    numbers: 'Цифры', none: 'Нет', population: 'Население', density: 'Плотность',
    cityMin: 'Города от', cityLimit: 'Не больше', lang: 'Язык', hint: 'H — скрыть панель',
    perKm2: 'чел/км²', mln: 'млн', bln: 'млрд', trln: 'трлн', byCountry: 'по странам', byRegion: 'по регионам', cityPopulation: 'Население города', value: 'Значение', change: 'Изменение', yourDataUpload: 'Свои данные (CSV, Excel)', compare: 'Сравнить с', smoothYear: 'Плавный год', off: 'Нет', close: 'Закрыть', sum: 'Сумма', year: 'Год', variant: 'Показатель', scenario: 'Сценарий полёта', legend: 'Легенда', chooseData: 'Выбор данных', video: 'Видео', videoHint: 'Записать сценарий в MP4 (на сервере, покадрово)', help: 'Как написать сценарий', searchData: 'Поиск: население, ВВП, климат…', nothingFound: 'Ничего не найдено', scene: 'Сцена', display: 'Отображение', current: 'Текущий набор', colorHeight: 'цвет и высота', noData: 'нет данных', sec: 'с', addKey: 'Кадр', addKeyHint: 'Добавить текущий ракурс и сцену ключевым кадром (+5 с)', keyframes: 'Ключевых кадров', importError: 'Сценарий не загружен', customData: 'пользовательские данные', yourData: 'Свой набор', thousand: 'тыс.', total: 'Население мира',
    loading: 'Загрузка данных…', source: 'Данные', data: 'Данные', focus: 'Фокус', world: 'Мир',
    mode: 'Вид', columns: 'Столбики', surface: 'Поверхность', theme: 'Тема', dark: 'Тёмная', light: 'Светлая',
    totalIn: 'Население', smooth: 'Сглаживание', soft: 'Мягкое', strong: 'Сильное',
    settings: 'Настройки', hidePanel: 'Скрыть панель (H)', pickScenario: 'Выберите сценарий', exportJson: 'Скачать сценарий (JSON)', importJson: 'Загрузить сценарий (JSON)',
  },
  en: {
    title: 'World Population Density', projection: 'Projection', globe: 'Globe', map: 'Map',
    detail: 'Detail', scale: 'Height scale', log: 'Log', sqrt: 'Sqrt', linear: 'Linear',
    height: 'Height', palette: 'Palette', labels: 'Labels', cities: 'Cities', countries: 'Countries',
    numbers: 'Numbers', none: 'None', population: 'Population', density: 'Density',
    cityMin: 'Cities from', cityLimit: 'At most', lang: 'Language', hint: 'H — hide panel',
    perKm2: 'people/km²', mln: 'M', bln: 'B', trln: 'T', byCountry: 'by country', byRegion: 'by region', cityPopulation: 'City population', value: 'Value', change: 'Change', yourDataUpload: 'Your data (CSV, Excel)', compare: 'Compare with', smoothYear: 'Smooth year', off: 'Off', close: 'Close', sum: 'Total', year: 'Year', variant: 'Indicator', scenario: 'Camera flight', legend: 'Legend', chooseData: 'Choose data', video: 'Video', videoHint: 'Render the scenario to MP4 (server-side, frame by frame)', help: 'How to write a scenario', searchData: 'Search: population, GDP, climate…', nothingFound: 'Nothing found', scene: 'Scene', display: 'Display', current: 'Current dataset', colorHeight: 'color & height', noData: 'no data', sec: 's', addKey: 'Keyframe', addKeyHint: 'Add current view and scene as a keyframe (+5 s)', keyframes: 'Keyframes', importError: 'Scenario not loaded', customData: 'custom data', yourData: 'Your dataset', thousand: 'K', total: 'World population',
    loading: 'Loading data…', source: 'Data', data: 'Dataset', focus: 'Focus', world: 'World',
    mode: 'View', columns: 'Columns', surface: 'Surface', theme: 'Theme', dark: 'Dark', light: 'Light',
    totalIn: 'Population', smooth: 'Smoothing', soft: 'Soft', strong: 'Strong',
    settings: 'Settings', hidePanel: 'Hide panel (H)', pickScenario: 'Choose a scenario', exportJson: 'Download scenario (JSON)', importJson: 'Load scenario (JSON)',
  },
} as const

export type Key = keyof typeof DICT.ru
export const t = (lang: Lang, key: Key): string => DICT[lang][key]
