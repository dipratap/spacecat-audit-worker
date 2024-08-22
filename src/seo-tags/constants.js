/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

// Tag Names
export const TITLE = 'title';
export const DESCRIPTION = 'description';
export const H1 = 'h1';

// SEO impact category
export const HIGH = 'High';
export const MODERATE = 'Moderate';

// Tags lengths
export const TAG_LENGTHS = {
  [TITLE]: {
    minLength: 40,
    maxLength: 60,
  },
  [DESCRIPTION]: {
    minLength: 140,
    maxLength: 160,
  },
  [H1]: {
    maxLength: 60,
  },
};