import struct
import unittest
from check_apk_size import check_elf

def elf(machine=183, alignment=16384, virtual=16384):
    data = bytearray(120)
    data[:6] = b'\x7fELF\x02\x01'
    struct.pack_into('<H', data, 18, machine)
    struct.pack_into('<Q', data, 32, 64)
    struct.pack_into('<HH', data, 54, 56, 1)
    struct.pack_into('<IIQQQQQQ', data, 64, 1, 5, 0, virtual, 0, 0, 0, alignment)
    return data

class NativePackagingTest(unittest.TestCase):
    def test_accepts_each_matching_64_bit_machine(self):
        check_elf(elf(), 'arm64-v8a')
        check_elf(elf(machine=62), 'x86_64')

    def test_rejects_library_for_other_architecture(self):
        with self.assertRaises(ValueError): check_elf(elf(machine=62), 'arm64-v8a')

    def test_rejects_4k_or_incongruent_load_segment(self):
        for bad in (elf(alignment=4096), elf(virtual=4096)):
            with self.assertRaises(ValueError): check_elf(bad, 'arm64-v8a')

    def test_rejects_truncated_or_non_elf_input(self):
        for bad in (b'', b'not a library', elf()[:80]):
            with self.assertRaises(ValueError): check_elf(bad, 'arm64-v8a')
