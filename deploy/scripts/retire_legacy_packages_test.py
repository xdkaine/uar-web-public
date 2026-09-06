import unittest
from retire_legacy_packages import validate_package, REPOSITORY

class RetirementTests(unittest.TestCase):
    def metadata(self,name): return {'name':name,'package_type':'container','repository':{'full_name':REPOSITORY}}
    def test_exact_legacy_packages(self):
        for name in ['uar-web-public-auth','uar-web-public-auth-migrate']:
            validate_package(name,self.metadata(name),['ghcr.io/xdkaine/auth-service@sha256:abc'])
    def test_current_package_denied(self):
        with self.assertRaises(ValueError): validate_package('auth-service',self.metadata('auth-service'),[])
    def test_live_reference_denied(self):
        for suffix in ['@sha256:abc',':dev-sha']:
            with self.assertRaises(ValueError):validate_package('uar-web-public-auth',self.metadata('uar-web-public-auth'),['ghcr.io/xdkaine/uar-web-public-auth'+suffix])
    def test_repository_mismatch_denied(self):
        m=self.metadata('uar-web-public-auth');m['repository']['full_name']='other/repo'
        with self.assertRaises(ValueError):validate_package('uar-web-public-auth',m,[])
