package dev.construct.runtime

import java.util.Locale

internal enum class SkyKind(val label: String) {
    JET("Jet aircraft"), BUSINESS("Business-jet model"), TURBOPROP("Turboprop"), PISTON("Propeller aircraft"),
    ROTORCRAFT("Rotorcraft"), GLIDER("Glider / sailplane"), BALLOON("Lighter-than-air"), UNKNOWN("Aircraft")
}
internal data class SkyModel(val name: String,val kind: SkyKind)

/** Small hand-curated factual type glossary, not a downloaded aircraft/ownership database.
 * Names describe a model, never the passengers, payload or purpose of the current flight.
 * Unknown codes are retained. See docs/sky-watch.md for provenance and limits. */
internal object SkyIdentity {
    private val models=buildMap {
        fun add(kind: SkyKind,vararg pairs: Pair<String,String>) { pairs.forEach { put(it.first,SkyModel(it.second,kind)) } }
        add(SkyKind.JET,"A318" to "Airbus A318","A319" to "Airbus A319","A320" to "Airbus A320","A321" to "Airbus A321",
            "A19N" to "Airbus A319neo","A20N" to "Airbus A320neo","A21N" to "Airbus A321neo",
            "A306" to "Airbus A300-600","A332" to "Airbus A330-200","A333" to "Airbus A330-300",
            "A338" to "Airbus A330-800","A339" to "Airbus A330-900","A343" to "Airbus A340-300","A346" to "Airbus A340-600",
            "A359" to "Airbus A350-900","A35K" to "Airbus A350-1000","A388" to "Airbus A380-800",
            "BCS1" to "Airbus A220-100","BCS3" to "Airbus A220-300",
            "B733" to "Boeing 737-300","B734" to "Boeing 737-400","B737" to "Boeing 737-700","B738" to "Boeing 737-800",
            "B739" to "Boeing 737-900","B38M" to "Boeing 737 MAX 8","B39M" to "Boeing 737 MAX 9",
            "B744" to "Boeing 747-400","B748" to "Boeing 747-8","B752" to "Boeing 757-200","B763" to "Boeing 767-300",
            "B772" to "Boeing 777-200","B77L" to "Boeing 777-200LR / 777F","B77W" to "Boeing 777-300ER",
            "B788" to "Boeing 787-8","B789" to "Boeing 787-9","B78X" to "Boeing 787-10",
            "E135" to "Embraer ERJ 135","E145" to "Embraer ERJ 145","E170" to "Embraer 170",
            "E175" to "Embraer 175","E190" to "Embraer 190","E195" to "Embraer 195","E290" to "Embraer E190-E2",
            "E295" to "Embraer E195-E2","CRJ7" to "Bombardier CRJ700","CRJ9" to "Bombardier CRJ900")
        add(SkyKind.BUSINESS,"C25A" to "Cessna Citation CJ2","C25B" to "Cessna Citation CJ3","C25C" to "Cessna Citation CJ4",
            "C56X" to "Cessna Citation Excel / XLS","C680" to "Cessna Citation Sovereign","C68A" to "Cessna Citation Latitude",
            "E50P" to "Embraer Phenom 100","E55P" to "Embraer Phenom 300","E35L" to "Embraer Legacy 600 / 650",
            "GLF5" to "Gulfstream V / G550","GLF6" to "Gulfstream G650","GLEX" to "Bombardier Global Express",
            "CL60" to "Bombardier Challenger 600 series","FA7X" to "Dassault Falcon 7X","FA8X" to "Dassault Falcon 8X")
        add(SkyKind.TURBOPROP,"AT43" to "ATR 42-300","AT45" to "ATR 42-500","AT46" to "ATR 42-600",
            "AT72" to "ATR 72-200","AT75" to "ATR 72-500","AT76" to "ATR 72-600","DH8D" to "De Havilland Dash 8-400",
            "PC12" to "Pilatus PC-12","TBM9" to "Daher TBM 900 series","BE20" to "Beechcraft King Air 200",
            "BE30" to "Beechcraft King Air 300","B350" to "Beechcraft King Air 350")
        add(SkyKind.PISTON,"C152" to "Cessna 152","C172" to "Cessna 172","C182" to "Cessna 182",
            "P28A" to "Piper PA-28 Cherokee / Archer","SR20" to "Cirrus SR20","SR22" to "Cirrus SR22","DA40" to "Diamond DA40","DA42" to "Diamond DA42")
        add(SkyKind.ROTORCRAFT,"EC35" to "Airbus H135 / Eurocopter EC135","EC45" to "Airbus H145 / Eurocopter EC145",
            "AS50" to "Airbus H125 / AS350","AS55" to "Airbus AS355","H160" to "Airbus H160","B06" to "Bell 206",
            "B407" to "Bell 407","R22" to "Robinson R22","R44" to "Robinson R44","R66" to "Robinson R66",
            "A109" to "Leonardo A109","A139" to "Leonardo AW139","S76" to "Sikorsky S-76")
    }
    fun model(code: String?)=code?.let { models[it.uppercase(Locale.ROOT)] }
    fun name(code: String?)=model(code)?.name ?: code?.let { "Aircraft type $it" } ?: "Type unknown"
    fun kind(a: SkyAircraft): SkyKind {
        if(a.identityConflict) return SkyKind.UNKNOWN
        val reported=when(a.category) { "Rotorcraft"->SkyKind.ROTORCRAFT; "Glider / sailplane"->SkyKind.GLIDER
            "Lighter-than-air"->SkyKind.BALLOON; else->null }
        val model=model(a.type)?.kind
        return if(reported!=null && model!=null && reported!=model) SkyKind.UNKNOWN else reported ?: model ?: SkyKind.UNKNOWN
    }
    fun adsbCategory(value: Any?): String? = when(value) {
        "A1"->"Light aircraft"; "A2"->"Small aircraft"; "A3"->"Large aircraft"; "A4"->"High-vortex large aircraft"
        "A5"->"Heavy aircraft"; "A6"->"High-performance aircraft"; "A7"->"Rotorcraft"; "B1"->"Glider / sailplane"
        "B2"->"Lighter-than-air"; "B3"->"Parachutist / skydiver"; "B4"->"Ultralight / hang-glider / paraglider"
        "B6"->"Unmanned aerial vehicle"; "B7"->"Space / trans-atmospheric vehicle"; else->null
    }
    fun openskyCategory(value: Any?): String? {
        val n=SkyData.number(value) ?: return null
        if(n!=n.toInt().toDouble()) return null
        return when(n.toInt()) { 2->adsbCategory("A1");3->adsbCategory("A2");4->adsbCategory("A3");5->adsbCategory("A4")
            6->adsbCategory("A5");7->adsbCategory("A6");8->adsbCategory("A7");9->adsbCategory("B1")
            10->adsbCategory("B2");11->adsbCategory("B3");12->adsbCategory("B4");14->adsbCategory("B6");15->adsbCategory("B7");else->null }
    }
}
