"use strict";
// Module-owned factual glossary; model does not establish a flight's purpose.
const SkyModels = {
  A318: {
    name: "Airbus A318",
    kind: "jet",
  },
  A319: {
    name: "Airbus A319",
    kind: "jet",
  },
  A320: {
    name: "Airbus A320",
    kind: "jet",
  },
  A321: {
    name: "Airbus A321",
    kind: "jet",
  },
  A19N: {
    name: "Airbus A319neo",
    kind: "jet",
  },
  A20N: {
    name: "Airbus A320neo",
    kind: "jet",
  },
  A21N: {
    name: "Airbus A321neo",
    kind: "jet",
  },
  A306: {
    name: "Airbus A300-600",
    kind: "jet",
  },
  A332: {
    name: "Airbus A330-200",
    kind: "jet",
  },
  A333: {
    name: "Airbus A330-300",
    kind: "jet",
  },
  A338: {
    name: "Airbus A330-800",
    kind: "jet",
  },
  A339: {
    name: "Airbus A330-900",
    kind: "jet",
  },
  A343: {
    name: "Airbus A340-300",
    kind: "jet",
  },
  A346: {
    name: "Airbus A340-600",
    kind: "jet",
  },
  A359: {
    name: "Airbus A350-900",
    kind: "jet",
  },
  A35K: {
    name: "Airbus A350-1000",
    kind: "jet",
  },
  A388: {
    name: "Airbus A380-800",
    kind: "jet",
  },
  BCS1: {
    name: "Airbus A220-100",
    kind: "jet",
  },
  BCS3: {
    name: "Airbus A220-300",
    kind: "jet",
  },
  B733: {
    name: "Boeing 737-300",
    kind: "jet",
  },
  B734: {
    name: "Boeing 737-400",
    kind: "jet",
  },
  B737: {
    name: "Boeing 737-700",
    kind: "jet",
  },
  B738: {
    name: "Boeing 737-800",
    kind: "jet",
  },
  B739: {
    name: "Boeing 737-900",
    kind: "jet",
  },
  B38M: {
    name: "Boeing 737 MAX 8",
    kind: "jet",
  },
  B39M: {
    name: "Boeing 737 MAX 9",
    kind: "jet",
  },
  B744: {
    name: "Boeing 747-400",
    kind: "jet",
  },
  B748: {
    name: "Boeing 747-8",
    kind: "jet",
  },
  B752: {
    name: "Boeing 757-200",
    kind: "jet",
  },
  B763: {
    name: "Boeing 767-300",
    kind: "jet",
  },
  B772: {
    name: "Boeing 777-200",
    kind: "jet",
  },
  B77L: {
    name: "Boeing 777-200LR / 777F",
    kind: "jet",
  },
  B77W: {
    name: "Boeing 777-300ER",
    kind: "jet",
  },
  B788: {
    name: "Boeing 787-8",
    kind: "jet",
  },
  B789: {
    name: "Boeing 787-9",
    kind: "jet",
  },
  B78X: {
    name: "Boeing 787-10",
    kind: "jet",
  },
  E135: {
    name: "Embraer ERJ 135",
    kind: "jet",
  },
  E145: {
    name: "Embraer ERJ 145",
    kind: "jet",
  },
  E170: {
    name: "Embraer 170",
    kind: "jet",
  },
  E175: {
    name: "Embraer 175",
    kind: "jet",
  },
  E190: {
    name: "Embraer 190",
    kind: "jet",
  },
  E195: {
    name: "Embraer 195",
    kind: "jet",
  },
  E290: {
    name: "Embraer E190-E2",
    kind: "jet",
  },
  E295: {
    name: "Embraer E195-E2",
    kind: "jet",
  },
  CRJ7: {
    name: "Bombardier CRJ700",
    kind: "jet",
  },
  CRJ9: {
    name: "Bombardier CRJ900",
    kind: "jet",
  },
  C25A: {
    name: "Cessna Citation CJ2",
    kind: "business",
  },
  C25B: {
    name: "Cessna Citation CJ3",
    kind: "business",
  },
  C25C: {
    name: "Cessna Citation CJ4",
    kind: "business",
  },
  C56X: {
    name: "Cessna Citation Excel / XLS",
    kind: "business",
  },
  C680: {
    name: "Cessna Citation Sovereign",
    kind: "business",
  },
  C68A: {
    name: "Cessna Citation Latitude",
    kind: "business",
  },
  E50P: {
    name: "Embraer Phenom 100",
    kind: "business",
  },
  E55P: {
    name: "Embraer Phenom 300",
    kind: "business",
  },
  E35L: {
    name: "Embraer Legacy 600 / 650",
    kind: "business",
  },
  GLF5: {
    name: "Gulfstream V / G550",
    kind: "business",
  },
  GLF6: {
    name: "Gulfstream G650",
    kind: "business",
  },
  GLEX: {
    name: "Bombardier Global Express",
    kind: "business",
  },
  CL60: {
    name: "Bombardier Challenger 600 series",
    kind: "business",
  },
  FA7X: {
    name: "Dassault Falcon 7X",
    kind: "business",
  },
  FA8X: {
    name: "Dassault Falcon 8X",
    kind: "business",
  },
  AT43: {
    name: "ATR 42-300",
    kind: "turboprop",
  },
  AT45: {
    name: "ATR 42-500",
    kind: "turboprop",
  },
  AT46: {
    name: "ATR 42-600",
    kind: "turboprop",
  },
  AT72: {
    name: "ATR 72-200",
    kind: "turboprop",
  },
  AT75: {
    name: "ATR 72-500",
    kind: "turboprop",
  },
  AT76: {
    name: "ATR 72-600",
    kind: "turboprop",
  },
  DH8D: {
    name: "De Havilland Dash 8-400",
    kind: "turboprop",
  },
  PC12: {
    name: "Pilatus PC-12",
    kind: "turboprop",
  },
  TBM9: {
    name: "Daher TBM 900 series",
    kind: "turboprop",
  },
  BE20: {
    name: "Beechcraft King Air 200",
    kind: "turboprop",
  },
  BE30: {
    name: "Beechcraft King Air 300",
    kind: "turboprop",
  },
  B350: {
    name: "Beechcraft King Air 350",
    kind: "turboprop",
  },
  C152: {
    name: "Cessna 152",
    kind: "piston",
  },
  C172: {
    name: "Cessna 172",
    kind: "piston",
  },
  C182: {
    name: "Cessna 182",
    kind: "piston",
  },
  P28A: {
    name: "Piper PA-28 Cherokee / Archer",
    kind: "piston",
  },
  SR20: {
    name: "Cirrus SR20",
    kind: "piston",
  },
  SR22: {
    name: "Cirrus SR22",
    kind: "piston",
  },
  DA40: {
    name: "Diamond DA40",
    kind: "piston",
  },
  DA42: {
    name: "Diamond DA42",
    kind: "piston",
  },
  EC35: {
    name: "Airbus H135 / Eurocopter EC135",
    kind: "rotorcraft",
  },
  EC45: {
    name: "Airbus H145 / Eurocopter EC145",
    kind: "rotorcraft",
  },
  AS50: {
    name: "Airbus H125 / AS350",
    kind: "rotorcraft",
  },
  AS55: {
    name: "Airbus AS355",
    kind: "rotorcraft",
  },
  H160: {
    name: "Airbus H160",
    kind: "rotorcraft",
  },
  B06: {
    name: "Bell 206",
    kind: "rotorcraft",
  },
  B407: {
    name: "Bell 407",
    kind: "rotorcraft",
  },
  R22: {
    name: "Robinson R22",
    kind: "rotorcraft",
  },
  R44: {
    name: "Robinson R44",
    kind: "rotorcraft",
  },
  R66: {
    name: "Robinson R66",
    kind: "rotorcraft",
  },
  A109: {
    name: "Leonardo A109",
    kind: "rotorcraft",
  },
  A139: {
    name: "Leonardo AW139",
    kind: "rotorcraft",
  },
  S76: {
    name: "Sikorsky S-76",
    kind: "rotorcraft",
  },
};
if (typeof module !== "undefined") module.exports = SkyModels;
