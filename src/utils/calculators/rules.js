import { calcDistance } from '@/utils/airports';
import { isInRegion } from './regions';
import { QantasEarnings } from '@/models/qantasEarnings';
import { REGION_DISPLAY } from '@/models/constants';

/**
 * All rules should implement these methods
 */
class Rule {
  constructor(name, ruleUrl) {
    this.name = name;
    this.ruleUrl = ruleUrl;
  }

  // eslint-disable-next-line
  applies(segment, fareEarnCategory) {
    return false;
  }

  // eslint-disable-next-line
  calculate(segment, fareEarnCategory) {
    return this.buildCalculationReturn('', '', 0, 0);
  }

  buildCalculationReturn(fareEarnCategory, notes, qantasPoints, statusCredits) {
    return {
      rule: this.name,
      ruleUrl: this.ruleUrl,
      fareEarnCategory,
      notes,
      qantasPoints,
      statusCredits,
    };
  }
}

export class IntraCountryRule extends Rule {
  constructor(name, ruleUrl, country, distanceBands) {
    super(name, ruleUrl);
    this.country = country;
    this.distanceRule = new DistanceRule(name, ruleUrl, distanceBands);
  }

  applies(segment, fareEarnCategory) {
    if (
      segment.fromAirport.country !== this.country ||
      segment.toAirport.country !== this.country
    ) {
      return false;
    }

    return this.distanceRule.applies(segment, fareEarnCategory);
  }

  calculate(segment, fareEarnCategory) {
    return this.distanceRule.calculate(segment, fareEarnCategory);
  }
}

/**
 * Distance based rule
 */
export class DistanceRule extends Rule {
  constructor(name, ruleUrl, distanceBands) {
    super(name, ruleUrl);
    this.distanceBands = distanceBands;
  }

  _getDistanceBand(distance) {
    return this.distanceBands.find((distanceBand) => {
      return (
        distanceBand.minDistance < distance &&
        (!('maxDistance' in distanceBand) || distance <= distanceBand.maxDistance)
      );
    });
  }

  applies(segment, fareEarnCategory) {
    const distance = calcDistance(segment.fromAirport, segment.toAirport);
    const distanceBand = this._getDistanceBand(distance);
    if (!distanceBand) {
      return false;
    }

    return fareEarnCategory in distanceBand.earnings;
  }

  calculate(segment, fareEarnCategory) {
    const distance = calcDistance(segment.fromAirport, segment.toAirport);

    const distanceBand = this._getDistanceBand(distance);
    if (!distanceBand) {
      throw new Error('No applicable distance band to calculate with for rule: ' + this.name);
    }

    const notesForDistance =
      'maxDistance' in distanceBand
        ? `using band ${distanceBand.minDistance} - ${distanceBand.maxDistance}`
        : `using band ${distanceBand.minDistance} and over`;

    return this.buildCalculationReturn(
      fareEarnCategory,
      `Distance calculated to ${distance} miles, ${notesForDistance}`,
      distanceBand.earnings[fareEarnCategory].qantasPoints,
      distanceBand.earnings[fareEarnCategory].statusCredits,
    );
  }
}

export class FareClassRule extends Rule {
  constructor(name, ruleUrl, fareClassEarnings) {
    super(name, ruleUrl);
    this.fareClassEarnings = fareClassEarnings;
  }

  // es-lint-disable-next-line
  applies(segment, fareEarnCategory) {
    return fareEarnCategory in this.fareClassEarnings;
  }

  // es-lint-disable-next-line
  calculate(segment, fareEarnCategory) {
    return this.buildCalculationReturn(
      fareEarnCategory,
      this.fareClassEarnings[fareEarnCategory].calculationNotes,
      this.fareClassEarnings[fareEarnCategory].qantasPoints,
      this.fareClassEarnings[fareEarnCategory].statusCredits,
    );
  }
}

/**
 * Rule for Geographical pairings. Can be setup in a few ways:
 * ...
 */
export class GeographicalRule extends Rule {
  constructor(name, ruleUrl, ruleConfig) {
    super(name, ruleUrl);
    this.ruleConfig = ruleConfig;
  }

  _getOrigin(airport) {
    if (this.ruleConfig.origin.city) {
      if (this.ruleConfig.origin.city.has(airport.city.toLowerCase())) {
        return { type: 'city', value: airport.city.toLowerCase() };
      }
    }

    if (this.ruleConfig.origin.country) {
      if (this.ruleConfig.origin.country.has(airport.country.toLowerCase())) {
        return { type: 'country', value: airport.country.toLowerCase() };
      }
    }

    if (this.ruleConfig.origin.region) {
      for (let region of this.ruleConfig.origin.region.values()) {
        if (isInRegion(airport.iata.toLowerCase(), region)) {
          return { type: 'region', value: region };
        }
      }
    }

    return null;
  }

  _getDestination(airport) {
    if (this.ruleConfig.destination.city) {
      if (airport.city.toLowerCase() in this.ruleConfig.destination.city) {
        return { type: 'city', value: airport.city.toLowerCase() };
      }
    }

    if (this.ruleConfig.destination.country) {
      if (airport.country.toLowerCase() in this.ruleConfig.destination.country) {
        return { type: 'country', value: airport.country.toLowerCase() };
      }
    }

    if (this.ruleConfig.destination.region) {
      for (let region of Object.keys(this.ruleConfig.destination.region)) {
        if (isInRegion(airport.iata.toLowerCase(), region)) {
          return { type: 'region', value: region };
        }
      }
    }

    return null;
  }

  _getOriginAndDestination(segment) {
    let origin = this._getOrigin(segment.fromAirport);
    let destination = this._getDestination(segment.toAirport);

    if (!origin || !destination) {
      origin = this._getOrigin(segment.toAirport);
      destination = this._getDestination(segment.fromAirport);
    }

    return { origin, destination };
  }

  _buildCalculationNotes(origin, destination) {
    const _buildCalculationNotesInner = (location) => {
      if (location.type === 'airport') {
        return `${location.value} airport`;
      } else if (location.type === 'city') {
        return location.value;
      } else if (location.type === 'country') {
        return location.value;
      } else if (location.type === 'region') {
        return REGION_DISPLAY[location.value] || location.value;
      } else {
        throw new Error(`Cannot create calcluation notes for unknown type ${location.type}`);
      }
    };

    return _buildCalculationNotesInner(origin) + ' to ' + _buildCalculationNotesInner(destination);
  }

  applies(segment, fareEarnCategory) {
    const { origin, destination } = this._getOriginAndDestination(segment);
    if (!origin || !destination) {
      return false;
    }

    const earnings = this.ruleConfig.destination[destination.type][destination.value];
    return fareEarnCategory in earnings;
  }

  calculate(segment, fareEarnCategory) {
    const { origin, destination } = this._getOriginAndDestination(segment);
    const earnings = this.ruleConfig.destination[destination.type][destination.value];

    return this.buildCalculationReturn(
      fareEarnCategory,
      this._buildCalculationNotes(origin, destination),
      earnings[fareEarnCategory].qantasPoints,
      earnings[fareEarnCategory].statusCredits,
    );
  }
}

export const parseEarningRates = (qantasPointsString, qantasCreditsString, fareClasses) => {
  const pointsPerFareclass = qantasPointsString
    .trim()
    .replace(/\,/gm, '')
    .replace(/\s+/gm, ' ')
    .split(' ');
  const creditsPerFareclass = qantasCreditsString.trim().replace(/\s+/gm, ' ').split(' ');
  const retval = {};

  fareClasses.forEach((fareClass, index) => {
    retval[fareClass] = new QantasEarnings(
      parseInt(pointsPerFareclass[index]) || 0,
      parseInt(creditsPerFareclass[index]) || 0,
    );
  });

  return retval;
};
