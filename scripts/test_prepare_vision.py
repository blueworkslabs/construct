import unittest
import hashlib
from prepare_vision import verified

class VisionIntegrityTests(unittest.TestCase):
    def test_truncated_extended_and_same_size_corrupted_models_are_rejected(self):
        data = b'example-model'
        entry = {'name': 'test', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        self.assertEqual(verified(data, entry), data)
        for bad in (data[:-1], data+b'!', b'X'+data[1:]):
            with self.subTest(bad=bad), self.assertRaises(ValueError): verified(bad, entry)
